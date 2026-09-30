-- Звонки: публичный эфир из чата.
--
-- Звонок участников чата сразу становится эфиром, который может слушать кто
-- угодно. Говорят только участники чата, остальные слушают — это решает
-- токен LiveKit, который выдаёт Edge Function `livekit-token` по данным
-- отсюда, а не интерфейс.
--
-- Кто сейчас в звонке, знает только LiveKit. База узнаёт это из его вебхука
-- (Edge Function `livekit-webhook`, функции `stream_participant_*` ниже):
-- клиентскому «я вышел» верить нельзя — приложение могут убить. Звонок
-- завершается, когда в нём не осталось ни одного участника чата; слушатели
-- его не удерживают.
--
-- Зависших звонков быть не должно, даже если вебхук потерялся:
--   * `livekit-token` перед выдачей токена сверяет с LiveKit звонок, в
--     котором по базе давно нет говорящих;
--   * `livekit-sync` сверяет звонок по просьбе клиента, открывшего чат;
--   * `pg_cron` раз в минуту завершает звонки, где говорящих нет дольше
--     двух минут (создатель так и не подключился, вебхук выхода потерян).

-- =============================================================================
-- streams
-- =============================================================================

create table public.streams (
  id uuid primary key default gen_random_uuid (),
  chat_id uuid not null references public.chats (id) on delete cascade,
  -- Кто начал звонок. Удаление аккаунта не стирает эфир из истории чата.
  host_id uuid references public.profiles (id) on delete set null,
  -- Комната LiveKit — одна на звонок и никогда не переиспользуется: поздний
  -- вход по старому токену не должен воскресить завершённый эфир.
  room_name text not null unique,
  status text not null default 'live' check (status in ('live', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (
    end_reason in ('everyone_left', 'room_finished', 'abandoned', 'reconciled')
  ),
  -- Сейчас в звонке: говорящих (участники чата) и слушателей. Пишет триггер
  -- на stream_participants, не клиент.
  speakers_count int not null default 0 check (speakers_count >= 0),
  listeners_count int not null default 0 check (listeners_count >= 0),
  -- Последний вход или выход говорящего: от него считается «звонок брошен».
  speakers_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((status = 'ended') = (ended_at is not null)),
  check ((status = 'ended') = (end_reason is not null)),
  check (room_name = 'stream-' || id::text)
);

-- Главный инвариант: в чате одновременно не больше одного живого звонка. Два
-- одновременных нажатия «Позвонить» не создадут двух эфиров, даже если
-- функция создания когда-нибудь ошибётся с блокировкой.
create unique index streams_one_live_per_chat on public.streams (chat_id) where status = 'live';

create index streams_chat_id_started_at_idx on public.streams (chat_id, started_at desc);
create index streams_live_idx on public.streams (speakers_changed_at) where status = 'live';

alter table public.streams enable row level security;

-- Эфир публичный: видеть, что в чате идёт звонок и сколько его слушают,
-- может любой вошедший. Пишут только функции ниже.
create policy "streams are readable by authenticated users"
  on public.streams for select
  to authenticated
  using (deleted_at is null);

revoke insert, update, delete on public.streams from anon, authenticated;

-- =============================================================================
-- stream_participants
-- =============================================================================

create table public.stream_participants (
  id uuid primary key default gen_random_uuid (),
  stream_id uuid not null references public.streams (id) on delete cascade,
  -- Публичная история эфира: удаление аккаунта обнуляет ссылку, строка живёт.
  user_id uuid references public.profiles (id) on delete set null,
  role text not null check (role in ('host', 'speaker', 'listener')),
  -- Первый вход. Вышел и вернулся — та же строка: joined_at не меняется.
  joined_at timestamptz not null,
  -- null — сейчас в звонке.
  left_at timestamptz,
  -- Текущее подключение в LiveKit. Выход старого подключения, пришедший после
  -- входа нового (переподключение), не выкидывает человека из звонка.
  livekit_sid text,
  -- Время последнего события LiveKit по этому человеку: вебхуки приходят не
  -- по порядку, и старое событие не должно перетирать новое.
  last_event_at timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (stream_id, user_id),
  check ((left_at is null) = (livekit_sid is not null))
);

create index stream_participants_user_id_idx on public.stream_participants (user_id);
create index stream_participants_connected_idx
  on public.stream_participants (stream_id, role)
  where left_at is null;

alter table public.stream_participants enable row level security;

create policy "stream_participants are readable by authenticated users"
  on public.stream_participants for select
  to authenticated
  using (deleted_at is null);

revoke insert, update, delete on public.stream_participants from anon, authenticated;

-- =============================================================================
-- Системные сообщения о звонке
-- =============================================================================
--
-- Звонок остаётся в истории чата двумя системными сообщениями: «начат» и
-- «завершён». Они ссылаются на звонок, а не описывают его текстом: кто начал,
-- сколько длился и был ли я в нём, клиент берёт из streams. Текст — запасной,
-- для превью и старых версий приложения.

alter table public.messages
  add column stream_id uuid references public.streams (id) on delete cascade,
  add column system_event text check (system_event in ('call_started', 'call_ended')),
  add constraint messages_system_event_is_system check (system_event is null or kind = 'system'),
  add constraint messages_system_event_has_stream check ((system_event is null) = (stream_id is null));

-- У звонка ровно одно «начат» и одно «завершён»: повторный вебхук о конце
-- эфира не допишет в чат второе сообщение.
create unique index messages_stream_event_key
  on public.messages (stream_id, system_event)
  where stream_id is not null;

-- «Звонок завершён · 12 мин». Та же запись, что у клиента (streams/callText).
create function public.call_duration_text(started timestamptz, ended timestamptz)
returns text
language plpgsql
immutable
as $$
declare
  seconds int := greatest(0, floor(extract(epoch from (ended - started)))::int);
begin
  if seconds < 60 then
    return seconds || ' с';
  end if;

  if seconds < 3600 then
    return (seconds / 60) || ' мин';
  end if;

  if (seconds % 3600) / 60 = 0 then
    return (seconds / 3600) || ' ч';
  end if;

  return (seconds / 3600) || ' ч ' || ((seconds % 3600) / 60) || ' мин';
end;
$$;

-- Превью звонка в списке чатов — «📞 Звонок», и для начала, и для конца.
create or replace function public.message_preview_text(m public.messages)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  voice_ms int;
begin
  if m.stream_id is not null then
    return '📞 Звонок';
  end if;

  if m.text is not null then
    return m.text;
  end if;

  if m.kind = 'media' then
    return '📷 Медиа';
  end if;

  if m.kind = 'voice' then
    select duration_ms into voice_ms
    from public.attachments
    where message_id = m.id
    limit 1;

    if voice_ms is not null then
      return format(
        '🎤 Голосовое сообщение (%s:%s)',
        greatest(voice_ms / 1000, 1) / 60,
        lpad((greatest(voice_ms / 1000, 1) % 60)::text, 2, '0')
      );
    end if;

    return '🎤 Голосовое сообщение';
  end if;

  return m.text;
end;
$$;

-- В рассылке нового сообщения теперь есть вид: о звонке человеку сообщает
-- входящий звонок, а не второе уведомление о системном сообщении.
create or replace function public.broadcast_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  member record;
  author_name text;
  preview_text text;
begin
  preview_text := public.message_preview_text(new);

  update public.chats
  set
    last_message_at = new.created_at,
    last_message_text = preview_text,
    last_message_author_id = new.author_id
  where id = new.chat_id;

  select display_name into author_name from public.profiles where id = new.author_id;

  payload := jsonb_build_object(
    'message_id', new.id,
    'chat_id', new.chat_id,
    'author_id', new.author_id,
    'author_name', author_name,
    'kind', new.kind,
    'text', preview_text,
    'created_at', new.created_at
  );

  begin
    perform realtime.send(payload, 'new_message', 'chat:' || new.chat_id::text, true);

    for member in
      select user_id from public.chat_members
      where chat_id = new.chat_id and user_id is distinct from new.author_id
    loop
      perform realtime.send(payload, 'new_message', 'user:' || member.user_id::text, true);
    end loop;

    for member in
      select invitee_id as user_id from public.chat_invites
      where chat_id = new.chat_id and status = 'pending' and invitee_id is not null
    loop
      perform realtime.send(
        jsonb_build_object('chat_id', new.chat_id),
        'invite_activity',
        'user:' || member.user_id::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;

  return new;
end;
$$;

-- Системные сообщения — история эфира, их не удаляет и автор: «Звонок начат»
-- от имени начавшего, но это не его реплика.
create or replace function public.delete_messages(message_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  wanted int;
  found int;
  foreign_count int;
  system_count int;
  chat_count int;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  wanted := coalesce(cardinality(array(select distinct unnest(message_ids))), 0);

  if wanted = 0 then
    return;
  end if;

  if wanted > 500 then
    raise exception 'too many messages in one call' using errcode = '22023';
  end if;

  perform 1 from public.messages where id = any (message_ids) for update;

  select
    count(*),
    count(*) filter (where author_id is distinct from caller),
    count(*) filter (where kind = 'system'),
    count(distinct chat_id)
  into found, foreign_count, system_count, chat_count
  from public.messages
  where id = any (message_ids);

  if found <> wanted then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if foreign_count > 0 then
    raise exception 'only own messages can be deleted' using errcode = '42501';
  end if;

  if system_count > 0 then
    raise exception 'system messages cannot be deleted' using errcode = '42501';
  end if;

  if chat_count > 1 then
    raise exception 'messages belong to different chats' using errcode = '22023';
  end if;

  update public.messages
  set deleted_at = now()
  where id = any (message_ids) and deleted_at is null;
end;
$$;

-- На системное сообщение не отвечают: цитата звонка ничего не цитирует.
create function public.forbid_reply_to_system()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.messages where id = new.quoted_id and kind = 'system') then
    raise exception 'system messages cannot be quoted' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger on_reply_to_system
  before insert on public.message_replies
  for each row execute function public.forbid_reply_to_system();

-- Был ли я в этом звонке — для «Пропущенный звонок» в переписке. Приходит той
-- же выборкой, что и страница сообщений (как `my_reaction`).
create function public.my_stream_participation(public.messages)
returns setof public.stream_participants
language sql
stable
rows 1
set search_path = public
as $$
  select *
  from public.stream_participants p
  where $1.stream_id is not null
    and p.stream_id = $1.stream_id
    and p.user_id = auth.uid()
    and p.deleted_at is null
$$;

revoke execute on function public.my_stream_participation(public.messages) from public, anon;
grant execute on function public.my_stream_participation(public.messages) to authenticated;

-- =============================================================================
-- Счётчики и события
-- =============================================================================

-- Счётчики пересчитываются по живым строкам, а не прибавлением: вебхуки
-- приходят не по порядку и повторяются, и дельта разъехалась бы.
create function public.count_stream_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.stream_id, old.stream_id);
  speakers int;
  listeners int;
begin
  select
    count(*) filter (where role in ('host', 'speaker')),
    count(*) filter (where role = 'listener')
  into speakers, listeners
  from public.stream_participants
  where stream_id = target and left_at is null;

  update public.streams
  set
    speakers_changed_at = case when speakers_count <> speakers then now() else speakers_changed_at end,
    speakers_count = speakers,
    listeners_count = listeners
  where id = target
    and (speakers_count <> speakers or listeners_count <> listeners);

  return null;
end;
$$;

create trigger on_stream_participants_changed
  after insert or update or delete on public.stream_participants
  for each row execute function public.count_stream_participants();

-- Начало, смена состава и конец звонка — сигнал в топик чата: полоса звонка
-- перечитывает звонок из базы, payload — только подсказка.
create function public.broadcast_stream_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and new.status = old.status
    and new.speakers_count = old.speakers_count
    and new.listeners_count = old.listeners_count then
    return null;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object(
        'chat_id', new.chat_id,
        'stream_id', new.id,
        'status', new.status,
        'speakers', new.speakers_count,
        'listeners', new.listeners_count
      ),
      'stream_changed',
      'chat:' || new.chat_id::text,
      true
    );
  exception
    when others then null;
  end;

  return null;
end;
$$;

create trigger on_stream_changed
  after insert or update on public.streams
  for each row execute function public.broadcast_stream_changed();

-- =============================================================================
-- Начать звонок
-- =============================================================================

/**
 * Начинает звонок в чате или возвращает уже идущий. Только участник чата.
 * `created = false` — звонок уже шёл, и кнопка ведёт в него.
 */
create function public.start_call(target_chat uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  chat public.chats;
  existing uuid;
  new_stream uuid := gen_random_uuid();
  host_name text;
  member record;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Строка чата под замком: второе одновременное нажатие ждёт здесь и дальше
  -- видит уже созданный звонок.
  select * into chat from public.chats where id = target_chat for update;

  if chat.id is null or chat.deleted_at is not null then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.chat_members where chat_id = target_chat and user_id = caller
  ) then
    raise exception 'only chat members can start a call' using errcode = '42501';
  end if;

  select id into existing from public.streams where chat_id = target_chat and status = 'live';

  if existing is not null then
    return jsonb_build_object('stream_id', existing, 'created', false);
  end if;

  insert into public.streams (id, chat_id, host_id, room_name)
  values (new_stream, target_chat, caller, 'stream-' || new_stream::text);

  insert into public.messages (chat_id, author_id, kind, text, stream_id, system_event)
  values (target_chat, caller, 'system', 'Звонок начат', new_stream, 'call_started');

  select display_name into host_name from public.profiles where id = caller;

  -- Входящий — участникам чата, кроме начавшего. Приглашённый, но не
  -- принявший заявку, участником не считается.
  begin
    for member in
      select user_id from public.chat_members
      where chat_id = target_chat and user_id <> caller
    loop
      perform realtime.send(
        jsonb_build_object(
          'stream_id', new_stream,
          'chat_id', target_chat,
          'chat_title', chat.title,
          'chat_kind', chat.kind,
          'host_id', caller,
          'host_name', host_name,
          'started_at', now()
        ),
        'incoming_call',
        'user:' || member.user_id::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;

  return jsonb_build_object('stream_id', new_stream, 'created', true);
end;
$$;

revoke execute on function public.start_call(uuid) from public, anon;
grant execute on function public.start_call(uuid) to authenticated;

-- =============================================================================
-- Завершить звонок
-- =============================================================================

/**
 * Завершает живой звонок: все выходят, в чат ложится «Звонок завершён»,
 * участники чата получают сигнал (у кого-то ещё звонит входящий). Повтор —
 * не ошибка: отдаёт false, если звонок уже был завершён.
 */
create function public.finish_stream(target_stream uuid, reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.streams;
  finished_at timestamptz := now();
  member record;
begin
  select * into s from public.streams where id = target_stream for update;

  if s.id is null or s.status <> 'live' then
    return false;
  end if;

  update public.stream_participants
  set left_at = finished_at, livekit_sid = null, last_event_at = greatest(last_event_at, finished_at)
  where stream_id = s.id and left_at is null;

  update public.streams
  set status = 'ended', ended_at = finished_at, end_reason = reason
  where id = s.id;

  insert into public.messages (chat_id, author_id, kind, text, stream_id, system_event)
  values (
    s.chat_id,
    null,
    'system',
    'Звонок завершён · ' || public.call_duration_text(s.started_at, finished_at),
    s.id,
    'call_ended'
  );

  begin
    for member in
      select user_id from public.chat_members where chat_id = s.chat_id
    loop
      perform realtime.send(
        jsonb_build_object('stream_id', s.id, 'chat_id', s.chat_id),
        'stream_ended',
        'user:' || member.user_id::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;

  return true;
end;
$$;

-- =============================================================================
-- Вебхук LiveKit
-- =============================================================================
--
-- Вызывает только Edge Function `livekit-webhook` сервисной ролью, после
-- проверки подписи LiveKit. identity участника комнаты — id пользователя,
-- его ставит `livekit-token`.

create function public.uuid_or_null(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return value::uuid;
exception
  when others then return null;
end;
$$;

/**
 * Кто-то вошёл в комнату. Отдаёт 'ok'; 'ended' — звонок уже завершён или
 * неизвестен, и комнату надо закрыть (поздний вход по старому токену).
 */
create function public.stream_participant_joined(
  room text,
  identity text,
  sid text,
  participant_role text,
  event_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.streams;
  who uuid := public.uuid_or_null(identity);
  resolved_role text;
begin
  select * into s from public.streams where room_name = room for update;

  if s.id is null or s.status <> 'live' then
    return 'ended';
  end if;

  if who is null or not exists (select 1 from public.profiles where id = who) then
    return 'unknown';
  end if;

  -- Роль — из токена, подписанного нами: она же решает, может ли человек
  -- говорить. Без роли — по базе.
  resolved_role := case
    when participant_role in ('host', 'speaker', 'listener') then participant_role
    when s.host_id = who then 'host'
    when exists (select 1 from public.chat_members where chat_id = s.chat_id and user_id = who)
      then 'speaker'
    else 'listener'
  end;

  insert into public.stream_participants
    (stream_id, user_id, role, joined_at, left_at, livekit_sid, last_event_at)
  values (s.id, who, resolved_role, event_at, null, sid, event_at)
  on conflict (stream_id, user_id) do update
  set left_at = null,
      livekit_sid = excluded.livekit_sid,
      role = excluded.role,
      last_event_at = excluded.last_event_at
  where stream_participants.last_event_at <= excluded.last_event_at;

  return 'ok';
end;
$$;

/**
 * Кто-то вышел. 'finished' — это был последний участник чата, звонок
 * завершён, комнату надо закрыть (слушатели отключатся). Иначе 'ok',
 * а для неизвестной или уже завершённой комнаты — 'ended'.
 */
create function public.stream_participant_left(
  room text,
  identity text,
  sid text,
  event_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.streams;
  who uuid := public.uuid_or_null(identity);
  left_role text;
begin
  select * into s from public.streams where room_name = room for update;

  if s.id is null or s.status <> 'live' then
    return 'ended';
  end if;

  update public.stream_participants
  set left_at = event_at, livekit_sid = null, last_event_at = event_at
  where stream_id = s.id
    and user_id = who
    and left_at is null
    and livekit_sid = sid
    and last_event_at <= event_at
  returning role into left_role;

  -- Ушёл слушатель или устаревшее подключение — звонок это не заканчивает.
  -- Говорящих до первого входа создателя тоже нет, поэтому решает только
  -- выход говорящего.
  if left_role is null or left_role = 'listener' then
    return 'ok';
  end if;

  if exists (
    select 1 from public.stream_participants
    where stream_id = s.id and left_at is null and role in ('host', 'speaker')
  ) then
    return 'ok';
  end if;

  perform public.finish_stream(s.id, 'everyone_left');

  return 'finished';
end;
$$;

/** Комната закрылась в LiveKit (пустая или удалена). */
create function public.stream_room_finished(room text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  select id into target from public.streams where room_name = room;

  if target is null then
    return 'ended';
  end if;

  return case when public.finish_stream(target, 'room_finished') then 'finished' else 'ended' end;
end;
$$;

/**
 * Сверка с LiveKit: `connected` — кто в комнате на самом деле, массив
 * {identity, sid, role}. Лишние в базе выходят, пропущенные входят. Если
 * говорящих не осталось и звонок старше минуты (создатель успел бы
 * подключиться), он завершается: 'finished'. Иначе 'ok' / 'ended'.
 */
create function public.reconcile_stream(room text, connected jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.streams;
  entry jsonb;
  at timestamptz := now();
  present uuid[] := '{}';
  who uuid;
begin
  select * into s from public.streams where room_name = room for update;

  if s.id is null or s.status <> 'live' then
    return 'ended';
  end if;

  for entry in select * from jsonb_array_elements(coalesce(connected, '[]'::jsonb))
  loop
    who := public.uuid_or_null(entry ->> 'identity');

    if who is null then
      continue;
    end if;

    present := present || who;
    perform public.stream_participant_joined(room, entry ->> 'identity', entry ->> 'sid', entry ->> 'role', at);
  end loop;

  update public.stream_participants
  set left_at = at, livekit_sid = null, last_event_at = at
  where stream_id = s.id and left_at is null and not (user_id = any (present));

  if s.started_at < at - interval '1 minute'
    and not exists (
      select 1 from public.stream_participants
      where stream_id = s.id and left_at is null and role in ('host', 'speaker')
    ) then
    perform public.finish_stream(s.id, 'reconciled');
    return 'finished';
  end if;

  return 'ok';
end;
$$;

/**
 * Всё, что нужно `livekit-token`, одним запросом: звонок, роль вызывающего и
 * его имя для комнаты. Роль решает база: участник чата говорит, остальные
 * слушают.
 */
create function public.stream_join_info(target_stream uuid, caller uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.streams;
  chat_alive boolean;
  is_member boolean;
  caller_name text;
begin
  select * into s from public.streams where id = target_stream and deleted_at is null;

  if s.id is null then
    return jsonb_build_object('found', false);
  end if;

  select c.deleted_at is null into chat_alive from public.chats c where c.id = s.chat_id;

  select exists (
    select 1 from public.chat_members where chat_id = s.chat_id and user_id = caller
  ) into is_member;

  select display_name into caller_name
  from public.profiles
  where id = caller and deleted_at is null;

  return jsonb_build_object(
    'found', true,
    'stream_id', s.id,
    'chat_id', s.chat_id,
    'room_name', s.room_name,
    'status', s.status,
    'chat_alive', coalesce(chat_alive, false),
    'profile_alive', caller_name is not null or exists (select 1 from public.profiles where id = caller and deleted_at is null),
    'role', case when not is_member then 'listener' when s.host_id = caller then 'host' else 'speaker' end,
    'display_name', caller_name,
    'speakers_count', s.speakers_count,
    'started_at', s.started_at,
    'speakers_changed_at', s.speakers_changed_at
  );
end;
$$;

/** Для pg_cron: звонки, где говорящих нет дольше двух минут. */
create function public.finish_abandoned_streams()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  n int := 0;
begin
  for target in
    select id from public.streams
    where status = 'live'
      and speakers_count = 0
      and speakers_changed_at < now() - interval '2 minutes'
  loop
    if public.finish_stream(target, 'abandoned') then
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;

-- Служебное — только сервисной роли (Edge Functions) и pg_cron.
revoke execute on function public.finish_stream(uuid, text) from public, anon, authenticated;
revoke execute on function public.stream_participant_joined(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.stream_participant_left(text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.stream_room_finished(text) from public, anon, authenticated;
revoke execute on function public.reconcile_stream(text, jsonb) from public, anon, authenticated;
revoke execute on function public.stream_join_info(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.finish_abandoned_streams() from public, anon, authenticated;
revoke execute on function public.count_stream_participants() from public, anon, authenticated;
revoke execute on function public.broadcast_stream_changed() from public, anon, authenticated;
revoke execute on function public.forbid_reply_to_system() from public, anon, authenticated;
revoke execute on function public.uuid_or_null(text) from public, anon, authenticated;

grant execute on function public.finish_stream(uuid, text) to service_role;
grant execute on function public.stream_participant_joined(text, text, text, text, timestamptz) to service_role;
grant execute on function public.stream_participant_left(text, text, text, timestamptz) to service_role;
grant execute on function public.stream_room_finished(text) to service_role;
grant execute on function public.reconcile_stream(text, jsonb) to service_role;
grant execute on function public.stream_join_info(uuid, uuid) to service_role;
grant execute on function public.finish_abandoned_streams() to service_role;

-- =============================================================================
-- Расписание
-- =============================================================================

create extension if not exists pg_cron;

select cron.schedule(
  'finish-abandoned-streams',
  '* * * * *',
  $$select public.finish_abandoned_streams()$$
);
