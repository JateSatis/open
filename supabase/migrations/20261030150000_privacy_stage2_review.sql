-- Правки по ревью этапа 2 приватности.
--
--   1. «@» в поиске людей отдавал всех: после снятия «@» запрос пустой, а
--      шаблон @имени становился «%%». Пустой после снятия «@» — знакомые,
--      как пустой запрос.
--   2. Видимость времени и прочтения считается одной функцией на строку
--      (`chat_visibility`), без повторного вызова `chat_time_visible`;
--      представление отдаёт и `reads_visible` — клиенту нужно знать, что
--      «прочитано» скрыто (взаимность), чтобы не рисовать вечную одну галочку.
--   3. Сигнал «перечитай» (`time_visibility_changed`) — и когда видимость
--      меняется без смены настройки: вступил или ушёл участник со скрытым
--      временем, появилась или пропала дружба.
--   4. «В сети» — по сеансу, а не по аккаунту: уход в фон одного устройства
--      не снимает «в сети», пока открыто другое.

-- =============================================================================
-- 1. Поиск людей: «@» — не шаблон «все»
-- =============================================================================

create or replace function public.search_people(
  query text default null,
  after_name text default null,
  after_id uuid default null,
  page_size int default 30
)
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  stripped text := btrim(ltrim(btrim(coalesce(query, '')), '@'));
  needle text := public.search_norm(stripped);
  pattern text;
  user_pattern text;
  lim int := least(greatest(coalesce(page_size, 30), 1), 50);
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  perform public.search_rate_hit('people');

  pattern := case when needle <> '' then public.search_like(needle) end;
  user_pattern := case when stripped <> '' then public.search_like(lower(stripped)) end;

  return query
  with known as (
    select k.person_id from public.known_people_ids(me) k
  )
  select p.id, p.display_name, p.username, p.avatar_url
  from public.profiles p
  where p.deleted_at is null
    and p.id <> me
    and (
      (pattern is null and p.id in (select person_id from known))
      or (
        pattern is not null
        and (
          public.search_norm(p.display_name) like pattern
          or lower(p.username) like user_pattern
        )
        and (
          p.id in (select person_id from known)
          or public.privacy_allows('account_search_visibility', p.id, me)
        )
      )
    )
    and (
      after_id is null
      or (coalesce(p.display_name, ''), p.id) > (coalesce(after_name, ''), after_id)
    )
  order by coalesce(p.display_name, ''), p.id
  limit lim;
end;
$$;

-- =============================================================================
-- 2. Видимость чата — одной функцией
-- =============================================================================

/**
 * Что смотрящему видно в чате: `visible` — время (никто из других участников
 * не скрывает его от смотрящего), `reads` — прочтение и просмотры участников
 * (время видно и собственная настройка смотрящего пускает каждого другого
 * участника). Быстрый путь — чат без признака и смотрящий с «Все»: ни одного
 * обращения к участникам.
 */
create function public.chat_visibility(p_chat uuid)
returns table (visible boolean, reads boolean)
language plpgsql
stable
security definer
rows 1
set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  restricted boolean;
  kind text;
  mine text;
begin
  select c.time_restricted, c.kind into restricted, kind from public.chats c where c.id = p_chat;

  visible := not coalesce(restricted, false);

  if not visible then
    visible := viewer is not null and not exists (
      select 1
      from public.chat_members cm
      where cm.chat_id = p_chat
        and cm.user_id <> viewer
        and not public.privacy_allows('message_activity_metadata_visibility', cm.user_id, viewer)
    );
  end if;

  reads := visible;

  if reads and viewer is not null and kind in ('direct', 'group') then
    select s.message_activity_metadata_visibility into mine
    from public.privacy_settings s
    where s.user_id = viewer;

    if mine is distinct from 'everyone' then
      reads := not exists (
        select 1
        from public.chat_members cm
        where cm.chat_id = p_chat
          and cm.user_id <> viewer
          and not public.privacy_allows('message_activity_metadata_visibility', viewer, cm.user_id)
      );
    end if;
  end if;

  return next;
end;
$$;

revoke execute on function public.chat_visibility(uuid) from public, anon;
grant execute on function public.chat_visibility(uuid) to authenticated;

create or replace function public.chat_time_visible(p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select v.visible from public.chat_visibility(p_chat) v
$$;

create or replace function public.chat_reads_visible(p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select v.reads from public.chat_visibility(p_chat) v
$$;

create or replace view public.message_rows as
select
  m.id,
  m.chat_id,
  m.author_id,
  m.kind,
  m.text,
  m.seq,
  case when t.visible then m.created_at end as created_at,
  case when t.visible then m.edited_at end as edited_at,
  m.edited_at is not null as edited,
  case when m.edited_at is not null then public.message_edit_count(m.id) end as edit_mark,
  case when t.reads then m.read_at end as read_at,
  m.deleted_at,
  m.member_reactions,
  m.visitor_reactions,
  m.reactions_count,
  m.comments_count,
  m.clusters_count,
  m.fragments_count,
  case when t.reads then m.views_count
    else greatest(m.views_count - m.member_views_count, 0) end as views_count,
  case when t.reads then m.unique_views_count
    else greatest(m.unique_views_count - m.member_unique_views_count, 0) end as unique_views_count,
  m.stream_id,
  m.system_event,
  m.system_user_id,
  m.source_chat_id,
  m.forwarded_comment_id,
  t.visible as time_visible,
  t.reads as reads_visible
from public.messages m
cross join lateral public.chat_visibility(m.chat_id) t
where m.deleted_at is null;

create or replace function public.chat_people(chat_ids uuid[])
returns table (
  chat_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  username text,
  last_read_at timestamptz,
  joined_at timestamptz,
  "position" int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if coalesce(cardinality(chat_ids), 0) > 500 then
    raise exception 'Слишком много чатов за раз' using errcode = '22023';
  end if;

  return query
  with shown as (
    select c.id, v.visible, v.reads
    from public.chats c
    cross join lateral public.chat_visibility(c.id) v
    where c.id = any (chat_ids) and c.deleted_at is null
  )
  select
    cm.chat_id,
    cm.user_id,
    p.display_name,
    p.avatar_url,
    p.username,
    case when s.reads then cm.last_read_at end,
    case when s.visible then cm.joined_at end,
    (row_number() over (partition by cm.chat_id order by cm.joined_at, cm.user_id) - 1)::int
  from public.chat_members cm
  join shown s on s.id = cm.chat_id
  left join public.profiles p on p.id = cm.user_id
  order by cm.chat_id, cm.joined_at, cm.user_id;
end;
$$;

-- =============================================================================
-- 3. «Перечитай» — и при смене состава и дружбы
-- =============================================================================

create or replace function public.refresh_chat_time_restricted(p_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chats
  set time_restricted = public.chat_time_restricted_now(p_chat)
  where id = p_chat
    and time_restricted is distinct from public.chat_time_restricted_now(p_chat);
end;
$$;

/** Видимость времени чата могла смениться — открытые экраны перечитывают. */
create function public.signal_time_visibility(p_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object('chat_id', p_chat),
    'time_visibility_changed',
    'chat:' || p_chat::text,
    true
  );
exception
  when others then null;
end;
$$;

create or replace function public.on_chat_member_time_restriction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chat uuid := coalesce(new.chat_id, old.chat_id);
  person uuid := coalesce(new.user_id, old.user_id);
begin
  perform public.refresh_chat_time_restricted(chat);

  -- Участник со скрытым временем вступил или ушёл — видимость поменялась у
  -- всех, кто смотрит этот чат.
  if exists (
    select 1 from public.privacy_settings s
    where s.user_id = person and s.message_activity_metadata_visibility <> 'everyone'
  ) then
    perform public.signal_time_visibility(chat);
  end if;

  return null;
end;
$$;

/**
 * Дружба появилась или пропала — «только друзьям» пускает или перестаёт
 * пускать: сигнал в скрывающие чаты обоих.
 */
create function public.on_friendship_time_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid := coalesce(new.requester_id, old.requester_id);
  b uuid := coalesce(new.addressee_id, old.addressee_id);
  chat record;
begin
  if (tg_op = 'UPDATE' and (old.status = 'accepted') = (new.status = 'accepted'))
    or (tg_op = 'INSERT' and new.status <> 'accepted')
    or (tg_op = 'DELETE' and old.status <> 'accepted')
  then
    return null;
  end if;

  for chat in
    select distinct cm.chat_id
    from public.chat_members cm
    join public.chats c on c.id = cm.chat_id and c.time_restricted
    where cm.user_id in (a, b)
  loop
    perform public.signal_time_visibility(chat.chat_id);
  end loop;

  return null;
end;
$$;

create trigger friendships_time_visibility
  after insert or update or delete on public.friendships
  for each row execute function public.on_friendship_time_visibility();

revoke execute on function public.signal_time_visibility(uuid) from public, anon, authenticated;
revoke execute on function public.on_friendship_time_visibility() from public, anon, authenticated;
revoke execute on function public.refresh_chat_time_restricted(uuid) from public, anon, authenticated;
revoke execute on function public.on_chat_member_time_restriction() from public, anon, authenticated;

-- =============================================================================
-- 4. «В сети» — по сеансу
-- =============================================================================

alter table public.user_presence add column session_id uuid;
alter table public.user_presence drop constraint user_presence_user_id_key;
alter table public.user_presence
  add constraint user_presence_user_session_key unique nulls not distinct (user_id, session_id);

create index user_presence_seen_idx on public.user_presence (last_seen_at);

/**
 * Отметить свой сеанс: на переднем плане — «в сети» ещё две минуты, иначе —
 * ушёл. Человек «в сети», пока хоть один его сеанс в сети.
 */
create or replace function public.mark_seen(online boolean default true)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_presence as u (user_id, session_id, last_seen_at, online_until)
  values (
    auth.uid(),
    public.current_session_id(),
    now(),
    case when online then now() + interval '2 minutes' end
  )
  on conflict (user_id, session_id) do update
    set last_seen_at = now(),
        online_until = excluded.online_until,
        updated_at = now()
    where not online
      or u.online_until is null
      or u.last_seen_at < now() - interval '20 seconds'
$$;

create or replace function public.activity_statuses(user_ids uuid[])
returns table (user_id uuid, online boolean, last_seen_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if coalesce(cardinality(user_ids), 0) > 200 then
    raise exception 'Слишком много людей за раз' using errcode = '22023';
  end if;

  return query
  select
    p.id,
    coalesce(allowed.yes and seen.online, false),
    case when allowed.yes then seen.last_at end
  from public.profiles p
  cross join lateral (
    select
      bool_or(u.online_until > now()) as online,
      max(u.last_seen_at) as last_at
    from public.user_presence u
    where u.user_id = p.id
  ) seen
  cross join lateral (
    select public.privacy_allows('activity_status_visibility', p.id, me) as yes
  ) allowed
  where p.id = any (coalesce(user_ids, '{}'))
    and p.deleted_at is null;
end;
$$;

/** Старые сеансы: оставить у человека только самую свежую отметку старше месяца. */
create function public.purge_user_presence()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_presence u
  where u.last_seen_at < now() - interval '30 days'
    and exists (
      select 1 from public.user_presence newer
      where newer.user_id = u.user_id and newer.last_seen_at > u.last_seen_at
    );
$$;

revoke execute on function public.purge_user_presence() from public, anon, authenticated;

select cron.schedule(
  'purge-user-presence',
  '23 4 * * *',
  $$select public.purge_user_presence()$$
);
