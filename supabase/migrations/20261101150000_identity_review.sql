-- Приватность, этап 4: правки по ревью.
--
-- * Обёртки, которые зовут представления (`message_people`, `comment_people`,
--   `reaction_person`, `invite_person`, `chat_row_people`), доступны клиенту и
--   напрямую — повторяют теперь фильтр своего представления: по id строки,
--   которую представление не отдало бы (заявка на диалог чужих, удалённое,
--   пара с блокировкой), они ничего не отдают.
-- * Начавший звонок — отдельной колонкой `message_rows.stream_host_id`: строку
--   «Звонок завершён» база пишет без автора, и «пропущенный» у самого
--   начавшего определялся неверно.
-- * Владелец снова читает (и потому удаляет) свою прежнюю папку аватаров в
--   `media` — на случай не перенесённых файлов.
-- * «Недавние»: перепроверка отдаёт и название чата глазами смотрящего — в
--   снимке лички осталось бы настоящее имя рядом с псевдонимом автора.

-- =============================================================================
-- Обёртки представлений — с фильтром представления
-- =============================================================================

create or replace function public.message_people(p_message uuid)
returns table (
  author_id uuid,
  author_name text,
  author_avatar_url text,
  author_opaque boolean,
  subject_id uuid,
  subject_name text,
  subject_opaque boolean
)
language plpgsql
stable
security definer
rows 1
set search_path = public
as $$
declare
  m record;
  a public.person_card;
  s public.person_card;
begin
  select x.chat_id, x.author_id, x.system_user_id into m
  from public.messages x
  where x.id = p_message and x.deleted_at is null and public.chat_readable(x.chat_id);

  if m.chat_id is null then
    author_opaque := false;
    subject_opaque := false;
    return next;
    return;
  end if;

  a := public.person_card(m.author_id, auth.uid(), m.chat_id);

  if m.system_user_id is not null then
    s := public.person_card(m.system_user_id, auth.uid(), m.chat_id);
  end if;

  author_id := a.id;
  author_name := a.display_name;
  author_avatar_url := a.avatar_url;
  author_opaque := coalesce(a.opaque, false);
  subject_id := s.id;
  subject_name := s.display_name;
  subject_opaque := coalesce(s.opaque, false);
  return next;
end;
$$;

create or replace function public.comment_people(p_comment uuid)
returns table (author_id uuid, author_name text, author_avatar_url text, author_opaque boolean)
language plpgsql
stable
security definer
rows 1
set search_path = public
as $$
declare
  r record;
  c public.person_card;
begin
  select x.author_id, x.chat_id into r
  from public.comments x
  where x.id = p_comment
    and x.deleted_at is null
    and (x.author_id is null or x.author_id <> all ((select public.my_block_peers())::uuid[]));

  -- Заглушка удалённого корня или комментарий, которого смотрящему не видно: автора нет.
  if r.chat_id is not null then
    c := public.person_card(r.author_id, auth.uid(), r.chat_id);
  end if;

  author_id := c.id;
  author_name := c.display_name;
  author_avatar_url := c.avatar_url;
  author_opaque := coalesce(c.opaque, false);
  return next;
end;
$$;

create or replace function public.reaction_person(p_reaction uuid)
returns table (user_id uuid, display_name text, avatar_url text, opaque boolean)
language plpgsql
stable
security definer
rows 1
set search_path = public
as $$
declare
  r record;
  c public.person_card;
begin
  select x.user_id, x.chat_id into r
  from public.reactions x
  where x.id = p_reaction
    and x.deleted_at is null
    and (x.user_id is null or x.user_id <> all ((select public.my_block_peers())::uuid[]));

  if r.chat_id is not null then
    c := public.person_card(r.user_id, auth.uid(), r.chat_id);
  end if;

  user_id := c.id;
  display_name := c.display_name;
  avatar_url := c.avatar_url;
  opaque := coalesce(c.opaque, false);
  return next;
end;
$$;

create or replace function public.invite_person(p_invite uuid)
returns table (user_id uuid, display_name text, avatar_url text, username text, opaque boolean)
language plpgsql
stable
security definer
rows 1
set search_path = public
as $$
declare
  r record;
  c public.person_card;
begin
  select x.invitee_id, x.chat_id into r
  from public.chat_invites x
  where x.id = p_invite and x.status <> 'accepted' and public.chat_readable(x.chat_id);

  if r.chat_id is not null then
    c := public.person_card(r.invitee_id, auth.uid(), r.chat_id);
  end if;

  user_id := c.id;
  display_name := c.display_name;
  avatar_url := c.avatar_url;
  username := c.username;
  opaque := coalesce(c.opaque, false);
  return next;
end;
$$;

create or replace function public.chat_row_people(p_chat uuid)
returns table (owner_id uuid, created_by uuid, last_message_author_id uuid)
language plpgsql
stable
security definer
rows 1
set search_path = public
as $$
declare
  c record;
  me uuid := auth.uid();
begin
  select x.owner_id, x.created_by, x.last_message_author_id into c
  from public.chats x
  where x.id = p_chat and public.chat_readable(x.id);

  owner_id := public.person_shown_id(c.owner_id, me, p_chat);
  created_by := public.person_shown_id(c.created_by, me, p_chat);
  last_message_author_id := public.person_shown_id(c.last_message_author_id, me, p_chat);
  return next;
end;
$$;

-- =============================================================================
-- Начавший звонок
-- =============================================================================

/** Начавший звонок системной строки — id глазами смотрящего. */
create function public.message_stream_host(p_message uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.person_shown_id(s.host_id, auth.uid(), m.chat_id)
  from public.messages m
  join public.streams s on s.id = m.stream_id
  where m.id = p_message and m.deleted_at is null and public.chat_readable(m.chat_id)
$$;

revoke execute on function public.message_stream_host(uuid) from public, anon;
grant execute on function public.message_stream_host(uuid) to authenticated;

create or replace view public.message_rows as
select
  m.id,
  m.chat_id,
  p.author_id,
  m.kind,
  case
    when h.hidden then null
    -- В тексте системной строки состава — имена: собрать заново с показанными.
    when m.system_event in ('member_invited', 'member_joined', 'member_left', 'member_removed', 'owner_changed')
      then public.member_event_text(m.system_event, p.author_name, p.subject_name)
    else m.text
  end as text,
  m.seq,
  case when t.visible then m.created_at end as created_at,
  case when t.visible and not h.hidden then m.edited_at end as edited_at,
  m.edited_at is not null and not h.hidden as edited,
  case when m.edited_at is not null and not h.hidden then public.message_edit_count(m.id) end as edit_mark,
  case when t.reads then m.read_at end as read_at,
  m.deleted_at,
  case when h.hidden then '{}'::jsonb else m.member_reactions end as member_reactions,
  case when h.hidden then '{}'::jsonb else m.visitor_reactions end as visitor_reactions,
  case when h.hidden then 0 else m.reactions_count end as reactions_count,
  case when h.hidden then 0 else m.comments_count end as comments_count,
  case when h.hidden then 0 else m.clusters_count end as clusters_count,
  case when h.hidden then 0 else m.fragments_count end as fragments_count,
  case when h.hidden then 0 when t.reads then m.views_count
    else greatest(m.views_count - m.member_views_count, 0) end as views_count,
  case when h.hidden then 0 when t.reads then m.unique_views_count
    else greatest(m.unique_views_count - m.member_unique_views_count, 0) end as unique_views_count,
  m.stream_id,
  m.system_event,
  p.subject_id as system_user_id,
  m.source_chat_id,
  m.forwarded_comment_id,
  t.visible as time_visible,
  t.reads as reads_visible,
  h.hidden,
  p.author_name,
  p.author_avatar_url,
  p.author_opaque,
  p.subject_name as system_user_name,
  p.subject_opaque as system_user_opaque,
  case when m.stream_id is not null then public.message_stream_host(m.id) end as stream_host_id
from public.messages m
cross join lateral public.chat_visibility(m.chat_id) t
cross join lateral (
  select case
    when m.author_id = any ((select public.my_blockers())::uuid[]) and m.kind <> 'system'
      then not public.blocker_message_visible(m.chat_id)
    else false
  end as hidden
) h
cross join lateral public.message_people(m.id) p
where m.deleted_at is null
  and public.chat_readable(m.chat_id);

-- =============================================================================
-- Прежняя папка аватаров в media — своя читается
-- =============================================================================

drop policy "media is readable by authenticated users" on storage.objects;

create policy "media is readable by authenticated users"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media'
    and (
      (storage.foldername(name))[2] is distinct from 'avatar'
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- =============================================================================
-- «Недавние»: и название чата
-- =============================================================================

drop function public.recheck_recent_searches(uuid[], uuid[]);

create function public.recheck_recent_searches(
  person_ids uuid[],
  message_ids uuid[],
  chat_ids uuid[] default '{}'
)
returns table (
  kind text,
  id uuid,
  created_at timestamptz,
  display_name text,
  username text,
  avatar_url text,
  chat_title text
)
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

  if coalesce(cardinality(person_ids), 0) > 50
    or coalesce(cardinality(message_ids), 0) > 50
    or coalesce(cardinality(chat_ids), 0) > 50
  then
    raise exception 'Слишком много за раз' using errcode = '22023';
  end if;

  return query
  select 'person'::text, p.id, null::timestamptz, card.display_name, card.username, card.avatar_url, null::text
  from public.profiles p
  cross join lateral public.person_card(p.id, me, null) card
  where p.id = any (coalesce(person_ids, '{}'))
    and p.deleted_at is null
    and card.id is not null
    and public.privacy_allows('account_search_visibility', p.id, me)
  union all
  select
    'message', m.id,
    case when public.chat_time_visible(m.chat_id) then m.created_at end,
    coalesce(card.display_name, 'Без имени'), null, null,
    face.title
  from public.messages m
  left join lateral public.person_card(m.author_id, me, m.chat_id) card on true
  left join lateral (
    select f.title from public.searchable_chats() f where f.chat_id = m.chat_id
  ) face on true
  where m.id = any (coalesce(message_ids, '{}'))
    and m.deleted_at is null
    and m.chat_id in (select s.chat_id from public.searchable_chat_ids() s)
    and public.message_found_by_author(m.chat_id, m.author_id, me)
  union all
  -- Свои чаты и подписки: название и лицо лички — собеседник глазами смотрящего.
  select 'chat', f.chat_id, null, f.title, f.username, f.avatar_url, f.title
  from public.searchable_chats() f
  where f.chat_id = any (coalesce(chat_ids, '{}'));
end;
$$;

revoke execute on function public.recheck_recent_searches(uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.recheck_recent_searches(uuid[], uuid[], uuid[]) to authenticated;
