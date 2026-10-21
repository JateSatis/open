-- Приватность, этап 3: блокировки, жалобы, защита от обхода (п. 4.3 ТЗ) —
-- таблицы и центральные проверки. Встройка проверок в создание чатов,
-- отправку, комментарии, реакции и поиск — в следующих миграциях.
--
--   blocks               кто кого заблокировал. Пишут только block_user /
--                        unblock_user / report_user; свои строки читает сам.
--   account_installations история «аккаунт — установка приложения». Строки
--                        `devices` уходят при выходе, а блокировка должна
--                        действовать и на аккаунты, вошедшие с того же
--                        устройства раньше или позже, — поэтому своя запись,
--                        которая при выходе не стирается.
--   reports              жалобы: вставляет только report_user, читает только
--                        сервисная роль.
--   account_restrictions автоограничение: аккаунт, который за окно времени
--                        заблокировали или на который пожаловались K разных
--                        людей, до restricted_until не обращается к не-друзьям.
--   safety_config        пороги и сроки — по версиям, как rec_config.
--   dialogue_requests    история заявок на диалог по паре (повторы после
--                        отказа считаются по ней, а не по живому чату).
--   contact_request_log  журнал обращений к не-друзьям для лимита частоты.
--
-- Блокировка распространяется на аккаунты того же устройства на стороне
-- заблокированного: B заблокировал A — для B недоступны и A, и любой аккаунт,
-- у которого с A есть общий installation_id. id установки генерирует клиент,
-- подделать его можно: это защита от обычного обхода (вышел — зашёл другим
-- аккаунтом), а не от целенаправленного.
--
-- Настройка «Заявки на диалог» уходит: заявка — правило для всех.

-- =============================================================================
-- «Заявки на диалог» — больше не настройка
-- =============================================================================

alter table public.privacy_settings drop column incoming_dialogue_requests;

create or replace function public.privacy_default_settings(p_minor boolean)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case when p_minor then jsonb_build_object(
    'profile_identity_masking', 'friends',
    'dialogue_participant_name_masking', 'friends',
    'activity_status_visibility', 'friends',
    'avatar_visibility', 'friends',
    'message_activity_metadata_visibility', 'friends',
    'account_search_visibility', 'friends',
    'dialogue_media_visibility', 'friends',
    'friends_list_visibility', 'nobody',
    'uploaded_media_metadata_stripping', true,
    'dialogue_hidden_text_visibility', 'enabled',
    'public_message_visibility_delay', 'random_delay'
  ) else jsonb_build_object(
    'profile_identity_masking', 'everyone',
    'dialogue_participant_name_masking', 'everyone',
    'activity_status_visibility', 'everyone',
    'avatar_visibility', 'everyone',
    'message_activity_metadata_visibility', 'everyone',
    'account_search_visibility', 'everyone',
    'dialogue_media_visibility', 'everyone',
    'friends_list_visibility', 'everyone',
    'uploaded_media_metadata_stripping', false,
    'dialogue_hidden_text_visibility', 'disabled',
    'public_message_visibility_delay', 'off'
  ) end
$$;

-- =============================================================================
-- Пороги и сроки
-- =============================================================================

create table public.safety_config (
  id uuid primary key default gen_random_uuid (),
  /** Действует строка с наибольшей версией; недостающие ключи — по умолчанию. */
  version int not null unique,
  params jsonb not null,
  note text,
  created_at timestamptz not null default now(),
  constraint safety_config_params_object check (jsonb_typeof(params) = 'object')
);

comment on table public.safety_config is
  'Пороги защиты от спама и преследования: лимиты заявок, повторы, автоограничения. Меняются вставкой новой версии, без миграции.';

alter table public.safety_config enable row level security;
revoke all on public.safety_config from anon, authenticated;

insert into public.safety_config (version, params, note) values (1, jsonb_build_object(
  -- Заявок на диалог и приглашений в группы не-друзьям за сутки — на все
  -- аккаунты устройства вместе.
  'contact_requests_per_day', 30,
  -- После отказа (или отмены своей заявки) новая той же паре — не раньше.
  'dialogue_retry_days', 30,
  -- Столько отказов подряд — и новых заявок этой паре больше нет.
  'dialogue_max_refusals', 2,
  -- Столько разных людей заблокировали или пожаловались за окно —
  'auto_restrict_actors', 5,
  'auto_restrict_window_hours', 48,
  -- — и аккаунт на столько часов теряет право обращаться к не-друзьям.
  'auto_restrict_hours', 72,
  -- Жалоб от одного человека за сутки.
  'reports_per_day', 30
), 'Значения этапа 3 приватности');

create function public.safety_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'contact_requests_per_day', 30,
    'dialogue_retry_days', 30,
    'dialogue_max_refusals', 2,
    'auto_restrict_actors', 5,
    'auto_restrict_window_hours', 48,
    'auto_restrict_hours', 72,
    'reports_per_day', 30
  ) || coalesce((select params from public.safety_config order by version desc limit 1), '{}'::jsonb)
$$;

create function public.safety_int(p_key text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (public.safety_settings() ->> p_key)::int
$$;

-- =============================================================================
-- Установки, с которых входил аккаунт
-- =============================================================================

create table public.account_installations (
  id uuid primary key default gen_random_uuid (),
  -- Каскад: приватные данные аккаунта.
  user_id uuid not null references public.profiles (id) on delete cascade,
  installation_id uuid not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, installation_id)
);

create index account_installations_installation_idx
  on public.account_installations (installation_id);

alter table public.account_installations enable row level security;
-- Политик нет: читают только функции.
revoke all on public.account_installations from anon, authenticated;

insert into public.account_installations (user_id, installation_id, created_at, last_seen_at)
select d.user_id, d.installation_id, d.created_at, d.last_seen_at
from public.devices d
on conflict (user_id, installation_id) do nothing;

create function public.remember_installation(p_user uuid, p_installation uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.account_installations as a (user_id, installation_id)
  values (p_user, p_installation)
  on conflict (user_id, installation_id) do update
    set last_seen_at = now()
    where a.last_seen_at < now() - interval '1 hour'
$$;

create or replace function public.register_device(
  p_installation_id uuid,
  p_platform text,
  p_model text,
  p_os_version text,
  p_app_version text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  sid uuid := public.current_session_id();
  previous_session uuid;
  device_id uuid;
begin
  if me is null or sid is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not exists (select 1 from auth.sessions where id = sid and user_id = me) then
    raise exception 'Сеанс завершён' using errcode = '28000';
  end if;

  select session_id into previous_session
  from public.devices
  where user_id = me and installation_id = p_installation_id;

  -- Сеанс сменился на том же устройстве (например, после привязки второго
  -- способа входа Auth выдаёт новый). Прежний больше никому не принадлежит:
  -- токен от него приложение уже выбросило, и висеть «призраком» в списке
  -- он не должен.
  if previous_session is not null and previous_session <> sid then
    delete from auth.sessions where id = previous_session and user_id = me;
  end if;

  -- Этот сеанс мог числиться за другой установкой того же человека — такое
  -- бывает, только если id установки потерялся. Сеанс переезжает сюда.
  update public.devices
  set session_id = null
  where session_id = sid and not (user_id = me and installation_id = p_installation_id);

  insert into public.devices as d (
    user_id, installation_id, session_id, platform, model, os_version, app_version, last_seen_at
  )
  values (me, p_installation_id, sid, p_platform, p_model, p_os_version, p_app_version, now())
  on conflict (user_id, installation_id) do update
  set session_id = excluded.session_id,
      platform = excluded.platform,
      model = excluded.model,
      os_version = excluded.os_version,
      app_version = excluded.app_version,
      last_seen_at = now(),
      signed_out_at = null
  returning d.id into device_id;

  perform public.remember_installation(me, p_installation_id);

  return device_id;
end;
$$;

create or replace function public.touch_device(p_installation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  sid uuid := public.current_session_id();
begin
  if me is null or sid is null then
    return false;
  end if;

  if not exists (select 1 from auth.sessions where id = sid and user_id = me) then
    return false;
  end if;

  -- Не чаще раза в пять минут: отметка нужна для списка устройств, а не
  -- для точного «в сети» — то живёт в user_presence.
  update public.devices
  set last_seen_at = now()
  where user_id = me
    and installation_id = p_installation_id
    and session_id = sid
    and last_seen_at < now() - interval '5 minutes';

  if p_installation_id is not null then
    perform public.remember_installation(me, p_installation_id);
  end if;

  return true;
end;
$$;

/** Аккаунт и все, кто входил с какой-нибудь из его установок. */
create function public.linked_accounts(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p_user where p_user is not null
  union
  select other.user_id
  from public.account_installations mine
  join public.account_installations other on other.installation_id = mine.installation_id
  where mine.user_id = p_user
$$;

-- =============================================================================
-- Блокировки
-- =============================================================================

create table public.blocks (
  id uuid primary key default gen_random_uuid (),
  -- Каскад: связь аккаунтов, не публичная история.
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint blocks_not_self check (blocker_id <> blocked_id),
  unique (blocker_id, blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id, created_at desc);

alter table public.blocks enable row level security;

create policy "blocks are readable by the blocker"
  on public.blocks for select
  to authenticated
  using (auth.uid() = blocker_id);

revoke all on public.blocks from anon;
revoke insert, update, delete on public.blocks from authenticated;

/**
 * Заблокированы ли двое в любую сторону — с учётом устройств заблокированного.
 * Единственная проверка блокировки для действий.
 */
create function public.blocked_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_a is not null and p_b is not null and p_a <> p_b and exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id in (select public.linked_accounts(p_b)))
       or (b.blocker_id = p_b and b.blocked_id in (select public.linked_accounts(p_a)))
  )
$$;

/**
 * Кто заблокировал смотрящего (или аккаунт его устройства): их сообщения в
 * чужих для смотрящего чатах приходят заглушкой.
 */
create function public.my_blockers()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct b.blocker_id), '{}')
  from public.blocks b
  where auth.uid() is not null
    and b.blocked_id in (select public.linked_accounts(auth.uid()))
$$;

/**
 * Все, с кем у смотрящего блокировка в любую сторону: их комментарии и
 * реакции смотрящему не показываются, его — им.
 */
create function public.my_block_peers()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct x), '{}')
  from (
    select b.blocker_id as x
    from public.blocks b
    where auth.uid() is not null
      and b.blocked_id in (select public.linked_accounts(auth.uid()))
    union
    select l
    from public.blocks b
    cross join lateral public.linked_accounts(b.blocked_id) l
    where b.blocker_id = auth.uid()
  ) peers
$$;

-- =============================================================================
-- Жалобы
-- =============================================================================

create table public.reports (
  id uuid primary key default gen_random_uuid (),
  -- Жалоба — материал модерации и остаётся после удаления любого аккаунта.
  reporter_id uuid references public.profiles (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete set null,
  target_kind text not null check (target_kind in ('dialogue_request', 'profile')),
  chat_id uuid references public.chats (id),
  reason text not null check (reason in ('spam', 'harassment', 'threats', 'other')),
  comment text check (char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  constraint reports_target_chat check ((target_kind = 'dialogue_request') = (chat_id is not null))
);

-- Повтор того же на того же по той же цели строк не плодит.
create unique index reports_once_key
  on public.reports (
    reporter_id,
    target_user_id,
    target_kind,
    coalesce(chat_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index reports_target_idx on public.reports (target_user_id, created_at desc);
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);

alter table public.reports enable row level security;
-- Читает только сервисная роль, вставляет только report_user.
revoke all on public.reports from anon, authenticated;

-- =============================================================================
-- Автоограничения
-- =============================================================================

create table public.account_restrictions (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  restricted_until timestamptz not null,
  -- Сколько разных людей насчитали при последнем срабатывании.
  actors int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_restrictions enable row level security;
revoke all on public.account_restrictions from anon, authenticated;

/**
 * Пересчитать автоограничение аккаунта: K разных людей за окно заблокировали
 * его или пожаловались — ограничен на T. Снимается само, по времени.
 */
create function public.refresh_auto_restriction(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(hours => public.safety_int('auto_restrict_window_hours'));
  n int;
begin
  if p_user is null then
    return;
  end if;

  select count(distinct actor) into n
  from (
    select b.blocker_id as actor
    from public.blocks b
    where b.blocked_id = p_user and b.created_at > since
    union
    select r.reporter_id
    from public.reports r
    where r.target_user_id = p_user and r.created_at > since and r.reporter_id is not null
  ) actors;

  if n < public.safety_int('auto_restrict_actors') then
    return;
  end if;

  insert into public.account_restrictions as r (user_id, restricted_until, actors)
  values (p_user, now() + make_interval(hours => public.safety_int('auto_restrict_hours')), n)
  on conflict (user_id) do update
    set restricted_until = greatest(
          r.restricted_until,
          now() + make_interval(hours => public.safety_int('auto_restrict_hours'))
        ),
        actors = excluded.actors,
        updated_at = now();
end;
$$;

create function public.on_block_or_report_restriction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Поля NEW разные у двух таблиц: обращение к чужому полю падает и в
  -- невыбранной ветке case.
  if tg_table_name = 'blocks' then
    perform public.refresh_auto_restriction(new.blocked_id);
  else
    perform public.refresh_auto_restriction(new.target_user_id);
  end if;

  return null;
end;
$$;

create trigger blocks_auto_restriction
  after insert on public.blocks
  for each row execute function public.on_block_or_report_restriction();

create trigger reports_auto_restriction
  after insert on public.reports
  for each row execute function public.on_block_or_report_restriction();

/** Ограничен ли аккаунт сейчас — он сам или любой аккаунт его устройства. */
create function public.contact_restricted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.account_restrictions r
    where r.user_id in (select public.linked_accounts(p_user))
      and r.restricted_until > now()
  )
$$;

-- =============================================================================
-- Заявки на диалог: история пары и частота
-- =============================================================================

alter table public.chats add column request_pending boolean not null default false;

comment on column public.chats.request_pending is
  'Личка-заявка от не-друга, ещё не принятая: видят только двое, у инициатора одно текстовое сообщение. Снимается принятием.';

create table public.dialogue_requests (
  id uuid primary key default gen_random_uuid (),
  chat_id uuid not null references public.chats (id),
  -- Каскад: история связи аккаунтов, не публичная.
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- null — ждёт ответа; declined — отказ (или блокировка); cancelled —
  -- отправитель удалил неотвеченную; accepted — принята.
  outcome text check (outcome in ('accepted', 'declined', 'cancelled')),
  closed_at timestamptz,
  constraint dialogue_requests_closed check ((outcome is null) = (closed_at is null)),
  constraint dialogue_requests_not_self check (requester_id <> addressee_id)
);

create unique index dialogue_requests_chat_key on public.dialogue_requests (chat_id);
create index dialogue_requests_pair_idx
  on public.dialogue_requests (requester_id, addressee_id, created_at desc);

alter table public.dialogue_requests enable row level security;
revoke all on public.dialogue_requests from anon, authenticated;

create table public.contact_request_log (
  id uuid primary key default gen_random_uuid (),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('dialogue', 'group_invite')),
  created_at timestamptz not null default now()
);

create index contact_request_log_requester_idx
  on public.contact_request_log (requester_id, created_at desc);

alter table public.contact_request_log enable row level security;
revoke all on public.contact_request_log from anon, authenticated;

/**
 * Хватит ли лимита на `p_count` новых обращений к не-друзьям за сутки — на
 * все аккаунты устройства вместе. Отказ — OPN10. Под блокировкой
 * отправителя: параллельные заявки встают в очередь и видят друг друга.
 */
create function public.check_contact_request_limit(p_user uuid, p_count int)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if coalesce(p_count, 0) <= 0 then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('contact_requests_of:' || p_user::text, 0));

  if (
    select count(*) from public.contact_request_log l
    where l.requester_id in (select public.linked_accounts(p_user))
      and l.created_at > now() - interval '1 day'
  ) + p_count > public.safety_int('contact_requests_per_day') then
    raise exception 'Слишком много заявок незнакомым людям, попробуйте завтра' using errcode = 'OPN10';
  end if;
end;
$$;

create function public.purge_contact_request_log()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.contact_request_log where created_at < now() - interval '2 days';
$$;

select cron.schedule(
  'purge-contact-request-log',
  '47 * * * *',
  $$select public.purge_contact_request_log()$$
);

-- =============================================================================
-- Видимость: блокировка в любую сторону — «не видно» для любой настройки
-- =============================================================================

create or replace function public.privacy_allows(p_setting text, p_owner uuid, p_viewer uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  visibility text;
begin
  if p_owner is null then
    return false;
  end if;

  if p_viewer is not null and p_viewer = p_owner then
    return true;
  end if;

  if p_setting not in (
    'profile_identity_masking', 'dialogue_participant_name_masking',
    'activity_status_visibility', 'avatar_visibility',
    'message_activity_metadata_visibility', 'account_search_visibility',
    'dialogue_media_visibility', 'friends_list_visibility'
  ) then
    raise exception 'Неизвестная настройка видимости: %', p_setting using errcode = '22023';
  end if;

  if public.blocked_pair(p_owner, p_viewer) then
    return false;
  end if;

  select case p_setting
      when 'profile_identity_masking' then s.profile_identity_masking
      when 'dialogue_participant_name_masking' then s.dialogue_participant_name_masking
      when 'activity_status_visibility' then s.activity_status_visibility
      when 'avatar_visibility' then s.avatar_visibility
      when 'message_activity_metadata_visibility' then s.message_activity_metadata_visibility
      when 'account_search_visibility' then s.account_search_visibility
      when 'dialogue_media_visibility' then s.dialogue_media_visibility
      when 'friends_list_visibility' then s.friends_list_visibility
    end
  into visibility
  from public.privacy_settings s
  where s.user_id = p_owner;

  return case coalesce(visibility, 'nobody')
    when 'everyone' then true
    when 'friends' then p_viewer is not null and public.are_friends(p_owner, p_viewer)
    else false
  end;
end;
$$;

-- =============================================================================
-- Права
-- =============================================================================

revoke execute on function public.safety_settings() from public, anon, authenticated;
revoke execute on function public.safety_int(text) from public, anon, authenticated;
revoke execute on function public.remember_installation(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.linked_accounts(uuid) from public, anon, authenticated;
revoke execute on function public.blocked_pair(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.refresh_auto_restriction(uuid) from public, anon, authenticated;
revoke execute on function public.on_block_or_report_restriction() from public, anon, authenticated;
revoke execute on function public.contact_restricted(uuid) from public, anon, authenticated;
revoke execute on function public.check_contact_request_limit(uuid, int) from public, anon, authenticated;
revoke execute on function public.purge_contact_request_log() from public, anon, authenticated;
revoke execute on function public.privacy_allows(text, uuid, uuid) from public, anon, authenticated;

-- Зовутся представлением и политиками с правами смотрящего; ответ — только
-- про него самого.
revoke execute on function public.my_blockers() from public, anon;
revoke execute on function public.my_block_peers() from public, anon;
grant execute on function public.my_blockers() to authenticated;
grant execute on function public.my_block_peers() to authenticated;

revoke execute on function public.register_device(uuid, text, text, text, text) from public, anon;
revoke execute on function public.touch_device(uuid) from public, anon;
grant execute on function public.register_device(uuid, text, text, text, text) to authenticated;
grant execute on function public.touch_device(uuid) to authenticated;
