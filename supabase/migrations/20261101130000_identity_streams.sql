-- Приватность, этап 4: звонки без настоящих id и имён в комнате LiveKit.

-- =============================================================================
-- Звонки: кто в эфире
-- =============================================================================
--
-- В комнате LiveKit участника видят все, кто в неё вошёл, — в том числе
-- слушатели-посторонние. Поэтому identity в токене — не id человека, а
-- непрозрачный id этого звонка (`stream_identity`), имени в токене нет. Кто
-- за identity стоит, клиент спрашивает у базы (`stream_people`) — и получает
-- человека глазами смотрящего, в контексте чата звонка. Вебхук LiveKit
-- переводит identity обратно через `stream_identities`.

create table public.stream_identities (
  id uuid primary key default gen_random_uuid (),
  stream_id uuid not null references public.streams (id) on delete cascade,
  -- Каскад: связь аккаунта, не публичная история.
  user_id uuid not null references public.profiles (id) on delete cascade,
  identity text not null,
  created_at timestamptz not null default now(),
  unique (stream_id, user_id),
  unique (stream_id, identity)
);

create index stream_identities_user_id_idx on public.stream_identities (user_id);

alter table public.stream_identities enable row level security;
revoke all on public.stream_identities from anon, authenticated;

/** Identity человека в звонке: одна на звонок, между звонками не совпадает. */
create function public.stream_identity(p_stream uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select encode(substring(public.identity_hmac('stream:' || p_stream || ':' || p_user) from 1 for 16), 'hex')::uuid::text
$$;

/** Кто стоит за identity в звонке. Токены, выданные до этой миграции, несли id человека. */
create function public.stream_identity_user(p_stream uuid, p_identity text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select si.user_id from public.stream_identities si where si.stream_id = p_stream and si.identity = p_identity),
    (
      select p.id from public.profiles p
      where p.id = public.uuid_or_null(p_identity)
        and not exists (select 1 from public.stream_identities si where si.stream_id = p_stream and si.identity = p_identity)
    )
  )
$$;

/** Для Edge Function `livekit-token`: запоминает identity и отдаёт её вместо имени. */
create or replace function public.stream_join_info(target_stream uuid, caller uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.streams;
  chat_alive boolean;
  is_member boolean;
  profile_alive boolean;
  caller_identity text;
begin
  select * into s from public.streams where id = target_stream and deleted_at is null;

  if s.id is null then
    return jsonb_build_object('found', false);
  end if;

  select c.deleted_at is null into chat_alive from public.chats c where c.id = s.chat_id;

  select exists (
    select 1 from public.chat_members where chat_id = s.chat_id and user_id = caller
  ) into is_member;

  profile_alive := exists (select 1 from public.profiles where id = caller and deleted_at is null);

  if profile_alive then
    caller_identity := public.stream_identity(s.id, caller);

    insert into public.stream_identities (stream_id, user_id, identity)
    values (s.id, caller, caller_identity)
    on conflict (stream_id, user_id) do nothing;
  end if;

  return jsonb_build_object(
    'found', true,
    'stream_id', s.id,
    'chat_id', s.chat_id,
    'room_name', s.room_name,
    'status', s.status,
    'chat_alive', coalesce(chat_alive, false),
    'profile_alive', profile_alive,
    'role', case when not is_member then 'listener' when s.host_id = caller then 'host' else 'speaker' end,
    'identity', caller_identity,
    'speakers_count', s.speakers_count,
    'started_at', s.started_at,
    'speakers_changed_at', s.speakers_changed_at
  );
end;
$$;

create or replace function public.stream_participant_joined(
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
  who uuid;
  resolved_role text;
begin
  select * into s from public.streams where room_name = room for update;

  if s.id is null or s.status <> 'live' then
    return 'ended';
  end if;

  who := public.stream_identity_user(s.id, identity);

  if who is null then
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

create or replace function public.stream_participant_left(room text, identity text, sid text, event_at timestamptz)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.streams;
  who uuid;
  left_role text;
begin
  select * into s from public.streams where room_name = room for update;

  if s.id is null or s.status <> 'live' then
    return 'ended';
  end if;

  who := public.stream_identity_user(s.id, identity);

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

create or replace function public.reconcile_stream(room text, connected jsonb)
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
    who := public.stream_identity_user(s.id, entry ->> 'identity');

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
 * Кто сейчас в звонке — глазами смотрящего, в контексте чата звонка:
 * identity из LiveKit → человек, как его показывать. Подменённому в диалоге
 * — непрозрачный id чата и его псевдоним.
 */
create function public.stream_people(target_stream uuid)
returns table (identity text, user_id uuid, display_name text, avatar_url text, opaque boolean, role text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  s public.streams;
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into s from public.streams where id = target_stream and deleted_at is null;

  if s.id is null or not public.chat_readable(s.chat_id) then
    return;
  end if;

  return query
  -- Без записи identity — токен, выданный до этой миграции: в нём id человека.
  select coalesce(si.identity, sp.user_id::text), card.id, card.display_name, card.avatar_url, card.opaque, sp.role
  from public.stream_participants sp
  left join public.stream_identities si on si.stream_id = sp.stream_id and si.user_id = sp.user_id
  cross join lateral public.person_card(sp.user_id, auth.uid(), s.chat_id) card
  where sp.stream_id = s.id
    and sp.left_at is null
    and sp.deleted_at is null
    and card.id is not null;
end;
$$;

/** Идущий звонок чата; начавший — глазами смотрящего. */
create function public.chat_live_stream(target_chat uuid)
returns table (
  id uuid,
  chat_id uuid,
  host_id uuid,
  started_at timestamptz,
  speakers_count integer,
  listeners_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.chat_id,
    public.person_shown_id(s.host_id, auth.uid(), s.chat_id),
    s.started_at,
    s.speakers_count,
    s.listeners_count
  from public.streams s
  where s.chat_id = target_chat
    and s.status = 'live'
    and s.deleted_at is null
    and public.chat_readable(s.chat_id)
$$;

/**
 * Звонки, которые мне сейчас звонят: живые, начатые не мной в чатах, где я
 * участник, не раньше `since` и без моего входа. Начавший — участник того же
 * чата, его id мне виден настоящим.
 */
create function public.my_ringing_streams(since timestamptz)
returns table (
  id uuid,
  chat_id uuid,
  host_id uuid,
  started_at timestamptz,
  speakers_count integer,
  listeners_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.chat_id, s.host_id, s.started_at, s.speakers_count, s.listeners_count
  from public.streams s
  join public.chat_members cm on cm.chat_id = s.chat_id and cm.user_id = auth.uid()
  where s.status = 'live'
    and s.deleted_at is null
    and s.host_id is distinct from auth.uid()
    and s.started_at >= since
    and not exists (
      select 1 from public.stream_participants sp
      where sp.stream_id = s.id and sp.user_id = auth.uid()
    )
$$;

revoke execute on function public.stream_identity(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.stream_identity_user(uuid, text) from public, anon, authenticated;
revoke execute on function public.stream_join_info(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.stream_participant_joined(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.stream_participant_left(text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.reconcile_stream(text, jsonb) from public, anon, authenticated;
revoke execute on function public.stream_people(uuid) from public, anon;
revoke execute on function public.chat_live_stream(uuid) from public, anon;
revoke execute on function public.my_ringing_streams(timestamptz) from public, anon;

grant execute on function public.stream_join_info(uuid, uuid) to service_role;
grant execute on function public.stream_participant_joined(text, text, text, text, timestamptz) to service_role;
grant execute on function public.stream_participant_left(text, text, text, timestamptz) to service_role;
grant execute on function public.reconcile_stream(text, jsonb) to service_role;
grant execute on function public.stream_people(uuid) to authenticated;
grant execute on function public.chat_live_stream(uuid) to authenticated;
grant execute on function public.my_ringing_streams(timestamptz) to authenticated;
