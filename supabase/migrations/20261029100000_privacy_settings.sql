-- Приватность, этап 1: дата рождения и настройки конфиденциальности.
--
-- У каждого аккаунта — одна строка `privacy_settings`: дата рождения (её
-- видит только владелец) и по колонке на каждую настройку. Строка рождается
-- вместе с профилем в `handle_new_user` с защитными значениями — теми же, что
-- у подростка, — поэтому аккаунт защищён с первой секунды, даже если клиент
-- ещё не показал экран даты. Первая установка даты (`set_birth_date`)
-- выставляет значения по возрасту ровно один раз; повторная дату меняет, а
-- настройки — нет. Совершеннолетие тоже ничего не переключает.
--
-- Видимость — три состояния по смыслу: `everyone` — видно всем, `friends` —
-- только друзьям, `nobody` — никому. Применяются настройки только через
-- `privacy_allows` (ниже): этапы 2–6 зовут её, а не читают колонки сами.
--
-- Аккаунт без даты дольше суток — брошенный на экране даты (или младше 13 и
-- просто закрыл приложение): его удаляет pg_cron.

-- =============================================================================
-- Значения по умолчанию — единственное место
-- =============================================================================
--
-- Ключи — имена колонок `privacy_settings`. Новая настройка этапов 2–6 =
-- колонка + ключ здесь (оба набора) + ветка в `privacy_allows`, если она
-- трёхзначная.

create function public.privacy_default_settings(p_minor boolean)
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
    'incoming_dialogue_requests', 'requests_only',
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
    'incoming_dialogue_requests', 'off',
    'dialogue_hidden_text_visibility', 'disabled',
    'public_message_visibility_delay', 'off'
  ) end
$$;

-- =============================================================================
-- privacy_settings
-- =============================================================================

create domain public.privacy_visibility as text
  check (value in ('everyone', 'friends', 'nobody'));

create table public.privacy_settings (
  id uuid primary key default gen_random_uuid (),
  -- Каскад: приватные данные аккаунта уходят вместе с ним.
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  birth_date date,
  -- Когда значения выставлены по возрасту. Null — ещё защитные с рождения
  -- аккаунта, дату не указывали.
  initialized_at timestamptz,
  profile_identity_masking public.privacy_visibility not null,
  dialogue_participant_name_masking public.privacy_visibility not null,
  activity_status_visibility public.privacy_visibility not null,
  avatar_visibility public.privacy_visibility not null,
  message_activity_metadata_visibility public.privacy_visibility not null,
  account_search_visibility public.privacy_visibility not null,
  dialogue_media_visibility public.privacy_visibility not null,
  friends_list_visibility public.privacy_visibility not null,
  uploaded_media_metadata_stripping boolean not null,
  incoming_dialogue_requests text not null check (incoming_dialogue_requests in ('off', 'requests_only')),
  dialogue_hidden_text_visibility text not null check (dialogue_hidden_text_visibility in ('enabled', 'disabled')),
  public_message_visibility_delay text not null check (public_message_visibility_delay in ('off', 'random_delay')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint privacy_settings_initialized_has_date check (initialized_at is null or birth_date is not null)
);

-- Под задачу брошенных аккаунтов.
create index privacy_settings_without_birth_date_idx
  on public.privacy_settings (created_at)
  where birth_date is null;

alter table public.privacy_settings enable row level security;

create policy "privacy_settings are readable by their owner"
  on public.privacy_settings for select
  to authenticated
  using (auth.uid() = user_id);

-- Пишут только функции ниже.
revoke all on public.privacy_settings from anon;
revoke insert, update, delete on public.privacy_settings from authenticated;

/** Строка с защитными значениями — для нового аккаунта. */
create function public.privacy_settings_row(p_user uuid, p_minor boolean)
returns public.privacy_settings
language sql
stable
set search_path = public
as $$
  select jsonb_populate_record(
    null::public.privacy_settings,
    jsonb_build_object(
      'id', gen_random_uuid(),
      'user_id', p_user,
      'created_at', now(),
      'updated_at', now()
    ) || public.privacy_default_settings(p_minor)
  )
$$;

/**
 * Выставляет настройки по набору значений по умолчанию. Колонки берутся из
 * ключей набора, так что новая настройка не требует правки здесь.
 */
create function public.apply_privacy_defaults(p_user uuid, p_minor boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  assignments text;
begin
  select string_agg(format('%I = %L', key, value #>> '{}'), ', ')
  into assignments
  from jsonb_each(public.privacy_default_settings(p_minor));

  execute format(
    'update public.privacy_settings set %s, updated_at = now() where user_id = $1',
    assignments
  ) using p_user;
end;
$$;

-- =============================================================================
-- Профиль и настройки — одной транзакцией
-- =============================================================================
--
-- Имя и фото из Google по-прежнему копируются в публичный профиль сразу —
-- подмена у подростка появится на этапе 4.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );

  insert into public.privacy_settings
  select * from public.privacy_settings_row(new.id, true);

  return new;
end;
$$;

-- =============================================================================
-- Возраст
-- =============================================================================

/** Полных лет на сегодня (по дате сервера). */
create function public.age_in_years(p_birth date)
returns int
language sql
stable
as $$
  select extract(year from age(current_date, p_birth))::int
$$;

-- =============================================================================
-- Центральная проверка видимости
-- =============================================================================
--
-- Видит ли зритель то, что владелец закрыл настройкой. Сам владелец видит
-- всё; `friends` — только принятая взаимная дружба (`are_friends`, миграция
-- друзей); `nobody` — никто; нет строки настроек — как `nobody`.
--
-- Наружу не выдаётся: вызов с чужими id отвечал бы, дружат ли двое
-- посторонних. Её зовут функции и политики на сервере.

create function public.privacy_allows(p_setting text, p_owner uuid, p_viewer uuid)
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

  if p_setting not in (
    'profile_identity_masking', 'dialogue_participant_name_masking',
    'activity_status_visibility', 'avatar_visibility',
    'message_activity_metadata_visibility', 'account_search_visibility',
    'dialogue_media_visibility', 'friends_list_visibility'
  ) then
    raise exception 'Неизвестная настройка видимости: %', p_setting using errcode = '22023';
  end if;

  return case coalesce(visibility, 'nobody')
    when 'everyone' then true
    when 'friends' then p_viewer is not null and public.are_friends(p_owner, p_viewer)
    else false
  end;
end;
$$;

-- =============================================================================
-- Чтение и изменение — только своё
-- =============================================================================

/** Мои дата рождения и настройки. */
create function public.my_privacy_settings()
returns public.privacy_settings
language sql
stable
set search_path = public
as $$
  select * from public.privacy_settings where user_id = auth.uid()
$$;

/**
 * Дата рождения. Возраст считает сервер. Будущая дата — OPN03, младше 13 —
 * OPN04; при отказе ничего не сохраняется. Первая установка выставляет
 * настройки по возрасту, повторная меняет только дату.
 *
 * Результат: `{birth_date, initialized}` — initialized = true, если именно
 * этот вызов выставил настройки.
 */
create function public.set_birth_date(p_birth_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  current_row public.privacy_settings;
  first_time boolean;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if p_birth_date is null then
    raise exception 'Укажите дату рождения' using errcode = '22023';
  end if;

  if p_birth_date > current_date then
    raise exception 'Дата рождения в будущем' using errcode = 'OPN03';
  end if;

  if public.age_in_years(p_birth_date) < 13 then
    raise exception 'Регистрация в Open возможна с 13 лет' using errcode = 'OPN04';
  end if;

  select * into current_row from public.privacy_settings where user_id = me for update;

  if not found then
    -- Аккаунт старше этой миграции без засева не бывает; на всякий случай
    -- строка создаётся защитной, как в handle_new_user.
    insert into public.privacy_settings
    select * from public.privacy_settings_row(me, true);

    select * into current_row from public.privacy_settings where user_id = me for update;
  end if;

  first_time := current_row.initialized_at is null;

  if first_time then
    perform public.apply_privacy_defaults(me, public.age_in_years(p_birth_date) < 18);
  end if;

  update public.privacy_settings
  set birth_date = p_birth_date,
      initialized_at = coalesce(initialized_at, now()),
      updated_at = now()
  where user_id = me;

  return jsonb_build_object('birth_date', p_birth_date, 'initialized', first_time);
end;
$$;

/**
 * Одна настройка своей строки. Ключ — из набора по умолчанию, значение
 * проверяют CHECK колонки (недопустимое — 22023). Дата и служебные колонки
 * так не меняются.
 */
create function public.set_privacy_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  column_type text;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if p_key is null or not (public.privacy_default_settings(true) ? p_key) then
    raise exception 'Неизвестная настройка: %', p_key using errcode = '22023';
  end if;

  select format_type(a.atttypid, a.atttypmod) into column_type
  from pg_attribute a
  where a.attrelid = 'public.privacy_settings'::regclass
    and a.attname = p_key
    and not a.attisdropped;

  begin
    execute format(
      'update public.privacy_settings set %I = $1::%s, updated_at = now() where user_id = $2',
      p_key,
      column_type
    ) using p_value, me;
  exception
    when check_violation or not_null_violation or invalid_text_representation then
      raise exception 'Недопустимое значение % для %', p_value, p_key using errcode = '22023';
  end;
end;
$$;

-- =============================================================================
-- Брошенные аккаунты без даты
-- =============================================================================
--
-- Создан больше суток назад и даты так и нет — человек закрыл приложение на
-- экране даты (или ему меньше 13). Удаление — тем же путём, что
-- auth.admin.deleteUser: строкой из auth.users; профиль, настройки, дружбы и
-- устройства уходят каскадом, ссылки публичной истории обнуляются. Файлы
-- аватара в Storage SQL не удалит — но до экрана профиля без даты не дойти,
-- загрузить их такой аккаунт из приложения не мог.

create function public.delete_abandoned_accounts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from auth.users u
  using public.privacy_settings s
  where s.user_id = u.id
    and s.birth_date is null
    and s.created_at < now() - interval '24 hours';

  get diagnostics n = row_count;

  return n;
end;
$$;

-- =============================================================================
-- Существующие аккаунты: случайная дата 13–40 лет, настройки по ней
-- =============================================================================
--
-- Экран даты им не показывается: дата есть. Повторный запуск ничего не
-- сбрасывает — строки создаются только тем, у кого их нет.

do $$
declare
  p record;
  birth date;
  newest date := (current_date - interval '13 years')::date;
  oldest date := (current_date - interval '41 years')::date + 1;
begin
  for p in
    select pr.id from public.profiles pr
    where not exists (select 1 from public.privacy_settings s where s.user_id = pr.id)
  loop
    birth := oldest + floor(random() * (newest - oldest + 1))::int;

    insert into public.privacy_settings
    select * from public.privacy_settings_row(p.id, public.age_in_years(birth) < 18);

    update public.privacy_settings
    set birth_date = birth, initialized_at = now()
    where user_id = p.id;
  end loop;
end;
$$;

-- =============================================================================
-- Права
-- =============================================================================

revoke execute on function public.privacy_default_settings(boolean) from public, anon;
revoke execute on function public.privacy_settings_row(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.apply_privacy_defaults(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.privacy_allows(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.delete_abandoned_accounts() from public, anon, authenticated;
revoke execute on function public.my_privacy_settings() from public, anon;
revoke execute on function public.set_birth_date(date) from public, anon;
revoke execute on function public.set_privacy_setting(text, text) from public, anon;

grant execute on function public.privacy_default_settings(boolean) to authenticated;
grant execute on function public.my_privacy_settings() to authenticated;
grant execute on function public.set_birth_date(date) to authenticated;
grant execute on function public.set_privacy_setting(text, text) to authenticated;

-- =============================================================================
-- Расписание
-- =============================================================================

select cron.schedule(
  'delete-abandoned-accounts',
  '17 * * * *',
  $$select public.delete_abandoned_accounts()$$
);
