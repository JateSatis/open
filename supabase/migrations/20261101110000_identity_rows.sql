-- Приватность, этап 4: люди в строках, которые читает клиент.
--
-- Сообщения, комментарии, реагировавшие и чаты отдаются глазами смотрящего:
-- автор, участник, владелец — через `person_card` в контексте чата строки.
-- Тот, от кого человек подменён в диалоге, не получает его настоящего id ни
-- в одном поле — вместо него непрозрачный id этого чата.
--
-- Представления зовут функции с правами смотрящего, поэтому то, что они
-- зовут, должно быть ему доступно. `person_card` клиенту закрыта, и
-- представления зовут её обёртки, ключённые id строки: `message_people(id
-- сообщения)` и т. п. По id строки они отдают ровно то, что отдаёт само
-- представление, — подставить чужого человека и чужой чат нельзя.
--
-- Сырые колонки с людьми у таблиц закрыты правами на колонки (или политикой,
-- где строки чужих людей клиенту не нужны вовсе):
--   messages: author_id, system_user_id, text (в тексте системных строк — имена);
--   comments: author_id;            message_fragments: author_id;
--   chats: owner_id, created_by, last_message_author_id, last_message_text,
--          founding_member_ids;
--   message_pins, comment_pins: pinned_by;    streams: host_id;
--   reactions — только свои строки;  chat_members — свои и своих чатов;
--   stream_participants — только свои.
-- Чтение сырой строки целиком (`select *`, вычисляемые поля таблицы) у
-- клиента после этого не проходит — он читает представления.

-- =============================================================================
-- Права на колонки
-- =============================================================================

/**
 * Закрыть колонки от чтения клиентом, оставив прочие, что читались и раньше.
 * Отзыв права на таблицу не снимает права на колонки — снимаются оба.
 */
create function pg_temp.restrict_select(p_table text, p_deny text[])
returns void
language plpgsql
as $$
declare
  every_column text;
  allowed text;
begin
  select
    string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
    string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) filter (
      where c.column_name <> all (p_deny)
        and exists (
          select 1 from information_schema.column_privileges cp
          where cp.table_schema = 'public'
            and cp.table_name = p_table
            and cp.column_name = c.column_name
            and cp.grantee = 'authenticated'
            and cp.privilege_type = 'SELECT'
        )
    )
  into every_column, allowed
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table;

  execute format('revoke select on public.%I from anon, authenticated', p_table);
  execute format('revoke select (%s) on public.%I from anon, authenticated', every_column, p_table);
  execute format('grant select (%s) on public.%I to authenticated', allowed, p_table);
end;
$$;

-- =============================================================================
-- Политики, которые читали закрываемое подзапросом
-- =============================================================================
--
-- Подзапрос в политике проверяет права смотрящего на колонки — закрытые
-- колонки читают функции с правами владельца.

drop policy "messages are readable by authenticated users" on public.messages;

create policy "messages are readable by authenticated users"
  on public.messages for select
  to authenticated
  using (
    deleted_at is null
    and public.chat_readable(chat_id)
    and case
      when author_id = any ((select public.my_blockers())::uuid[]) and kind <> 'system'
        then public.blocker_message_visible(chat_id)
      else true
    end
  );

/** Свой ли это комментарий, только что отправленный, — для вложений и цитат. */
create function public.comment_sent_now(p_comment uuid, p_target uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.comments c
    where c.id = p_comment
      and (p_target is null or c.target_id = p_target)
      and c.author_id = auth.uid()
      and c.created_at = now()
  )
$$;

drop policy "comment_attachments are added by the author when sending" on public.comment_attachments;

create policy "comment_attachments are added by the author when sending"
  on public.comment_attachments for insert
  to authenticated
  with check (public.comment_sent_now(comment_id));

drop policy "comment_replies are attached by the author when sending" on public.comment_replies;

create policy "comment_replies are attached by the author when sending"
  on public.comment_replies for insert
  to authenticated
  with check (
    public.comment_sent_now(comment_id, target_id)
    and exists (
      select 1 from public.comments q
      where q.id = comment_replies.quoted_id and q.target_id = comment_replies.target_id
    )
  );

/** Участник ли смотрящий этого чата. */
create function public.am_chat_member(p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_members
    where chat_id = p_chat and user_id = auth.uid()
  )
$$;

-- Состав чужого чата клиент читает через `chat_people` — глазами смотрящего.
drop policy "chat_members are readable by authenticated users" on public.chat_members;

create policy "chat_members are readable by members of the chat"
  on public.chat_members for select
  to authenticated
  using (user_id = auth.uid() or public.am_chat_member(chat_id));

-- Реакции клиент читает только свои (`my_reaction`); кто поставил чужие —
-- `reactors`, глазами смотрящего.
drop policy "reactions are readable by authenticated users" on public.reactions;

create policy "reactions are readable by their author"
  on public.reactions for select
  to authenticated
  using (user_id = auth.uid() and deleted_at is null);

-- Кто в звонке — `stream_people`, глазами смотрящего.
drop policy "stream_participants are readable by authenticated users" on public.stream_participants;

create policy "stream_participants are readable by the participant"
  on public.stream_participants for select
  to authenticated
  using (user_id = auth.uid() and deleted_at is null);

select pg_temp.restrict_select('messages', array['author_id', 'system_user_id', 'text']);
select pg_temp.restrict_select('comments', array['author_id']);
select pg_temp.restrict_select('message_fragments', array['author_id']);
select pg_temp.restrict_select('chats', array['owner_id', 'created_by', 'last_message_author_id', 'last_message_text', 'founding_member_ids']);
select pg_temp.restrict_select('message_pins', array['pinned_by']);
select pg_temp.restrict_select('comment_pins', array['pinned_by']);
select pg_temp.restrict_select('streams', array['host_id']);

-- =============================================================================
-- Сообщения
-- =============================================================================

/** Автор и второй человек системной строки — глазами смотрящего, в контексте чата сообщения. */
create function public.message_people(p_message uuid)
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
  select x.chat_id, x.author_id, x.system_user_id into m from public.messages x where x.id = p_message;

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

-- Колонки дописаны в конец: представление заменяется на месте.
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
  p.subject_opaque as system_user_opaque
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
-- Реагировавшие
-- =============================================================================

/** Кто поставил реакцию — глазами смотрящего, в контексте чата цели. */
create function public.reaction_person(p_reaction uuid)
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
  select x.user_id, x.chat_id into r from public.reactions x where x.id = p_reaction;

  c := public.person_card(r.user_id, auth.uid(), r.chat_id);

  user_id := c.id;
  display_name := c.display_name;
  avatar_url := c.avatar_url;
  opaque := coalesce(c.opaque, false);
  return next;
end;
$$;

create view public.reactor_rows as
select
  r.id,
  r.target_type,
  r.target_id,
  r.emoji,
  r.audience,
  r.created_at,
  r.updated_at,
  p.user_id,
  p.display_name,
  p.avatar_url,
  p.opaque
from public.reactions r
cross join lateral public.reaction_person(r.id) p
where r.deleted_at is null
  and (r.user_id is null or r.user_id <> all ((select public.my_block_peers())::uuid[]));

grant select on public.reactor_rows to authenticated;

drop function public.reactors(public.message_rows);
drop function public.reactors(public.messages);
drop function public.reactors(public.comments);

/** У сообщения — участники, поставившие реакцию, которую поставили один-два человека. */
create function public.reactors(public.message_rows)
returns setof public.reactor_rows
language sql
stable
security definer
rows 40
set search_path = public
as $$
  select r.*
  from jsonb_each_text($1.member_reactions) e
  cross join lateral (
    select *
    from public.reactor_rows x
    where x.target_type = 'message'
      and x.target_id = $1.id
      and x.emoji = e.key
      and x.audience = 'member'
    order by x.updated_at
    limit 2
  ) r
  where e.value::int <= 2
$$;

-- Своя реакция: строки реакций клиенту отдаются только свои, но `select *`
-- функции с правами смотрящего упёрся бы в права на колонки — с правами
-- владельца и только своя.
create or replace function public.my_reaction(public.message_rows)
returns setof public.reactions
language sql
stable
security definer
rows 1
set search_path = public
as $$
  select *
  from public.reactions r
  where r.target_type = 'message'
    and r.target_id = $1.id
    and r.user_id = auth.uid()
    and r.deleted_at is null
$$;

create or replace function public.my_reaction(public.pops)
returns setof public.reactions
language sql
stable
security definer
rows 1
set search_path = public
as $$
  select *
  from public.reactions r
  where r.target_type = 'pop'
    and r.target_id = $1.id
    and r.user_id = auth.uid()
    and r.deleted_at is null
$$;

create or replace function public.my_reaction(public.message_fragments)
returns setof public.reactions
language sql
stable
security definer
rows 1
set search_path = public
as $$
  select *
  from public.reactions r
  where r.target_type = 'fragment'
    and r.target_id = $1.id
    and r.user_id = auth.uid()
    and r.deleted_at is null
$$;

-- Строки `messages` и `comments` клиенту целиком больше не читаются.
drop function public.my_reaction(public.messages);
drop function public.my_reaction(public.comments);
drop function public.my_stream_participation(public.messages);

-- =============================================================================
-- Комментарии
-- =============================================================================

/** Автор комментария — глазами смотрящего, в контексте чата комментария. */
create function public.comment_people(p_comment uuid)
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
  select x.author_id, x.chat_id, x.deleted_at into r from public.comments x where x.id = p_comment;

  -- Заглушка удалённого корня: автора нет.
  if r.deleted_at is null then
    c := public.person_card(r.author_id, auth.uid(), r.chat_id);
  end if;

  author_id := c.id;
  author_name := c.display_name;
  author_avatar_url := c.avatar_url;
  author_opaque := coalesce(c.opaque, false);
  return next;
end;
$$;

/**
 * Комментарии глазами смотрящего. Повторяет SELECT-политику `comments`
 * (живые, не от пары с блокировкой) и, как `list_comment_thread_roots`,
 * отдаёт заглушку удалённого корня с живыми ответами: без автора, текста и
 * реакций.
 */
create view public.comment_rows as
select
  c.id,
  c.chat_id,
  c.message_id,
  p.author_id,
  c.kind,
  case when c.deleted_at is null then c.text end as text,
  c.audience,
  c.created_at,
  case when c.deleted_at is null then c.edited_at end as edited_at,
  c.deleted_at,
  case when c.deleted_at is null then c.member_reactions else '{}'::jsonb end as member_reactions,
  case when c.deleted_at is null then c.visitor_reactions else '{}'::jsonb end as visitor_reactions,
  case when c.deleted_at is null then c.reactions_count else 0 end as reactions_count,
  c.thread_root_id,
  c.replies_count,
  c.rank,
  c.pop_id,
  c.target_id,
  c.fragment_id,
  p.author_name,
  p.author_avatar_url,
  p.author_opaque
from public.comments c
cross join lateral public.comment_people(c.id) p
where (c.deleted_at is null or (c.thread_root_id is null and c.replies_count > 0))
  and (c.author_id is null or c.author_id <> all ((select public.my_block_peers())::uuid[]));

grant select on public.comment_rows to authenticated;

create function public.reactors(public.comment_rows)
returns setof public.reactor_rows
language sql
stable
security definer
rows 40
set search_path = public
as $$
  select r.*
  from jsonb_each_text(public.reaction_counts_merge($1.member_reactions, $1.visitor_reactions)) e
  cross join lateral (
    select *
    from public.reactor_rows x
    where x.target_type = 'comment'
      and x.target_id = $1.id
      and x.emoji = e.key
    order by x.updated_at
    limit 2
  ) r
  where e.value::int <= 2
$$;

create function public.my_reaction(public.comment_rows)
returns setof public.reactions
language sql
stable
security definer
rows 1
set search_path = public
as $$
  select *
  from public.reactions r
  where r.target_type = 'comment'
    and r.target_id = $1.id
    and r.user_id = auth.uid()
    and r.deleted_at is null
$$;

drop function public.list_comment_thread_roots(uuid, double precision, uuid, integer, uuid, uuid, integer, integer);

create function public.list_comment_thread_roots(
  target uuid,
  after_rank double precision default null,
  after_id uuid default null,
  page_size integer default 30,
  fragment uuid default null,
  cluster uuid default null,
  area_start integer default null,
  area_end integer default null
)
returns setof public.comment_rows
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  fragments uuid[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  fragments := public.fragment_set_ids(target, fragment, cluster, area_start, area_end);

  return query
  select *
  from public.comment_rows c
  where c.target_id = target
    and c.thread_root_id is null
    and (fragments is null or c.fragment_id = any (fragments))
    and (after_rank is null or (c.rank, c.id) < (after_rank, after_id))
  order by c.rank desc, c.id desc
  limit least(greatest(coalesce(page_size, 30), 1), 100);
end;
$$;

-- Верх треда сообщения — прежняя обёртка над `list_comment_thread_roots`.
drop function public.list_thread_roots(uuid, double precision, uuid, integer);

create function public.list_thread_roots(
  target_message uuid,
  after_rank double precision default null,
  after_id uuid default null,
  page_size integer default 30
)
returns setof public.comment_rows
language sql
stable
set search_path = public
as $$
  select * from public.list_comment_thread_roots(target_message, after_rank, after_id, page_size)
  where message_id = target_message
$$;

revoke execute on function public.list_thread_roots(uuid, double precision, uuid, integer) from public, anon;
grant execute on function public.list_thread_roots(uuid, double precision, uuid, integer) to authenticated;

drop function public.pinned_comment(uuid, uuid, uuid, integer, integer);

create function public.pinned_comment(
  target uuid,
  fragment uuid default null,
  cluster uuid default null,
  area_start integer default null,
  area_end integer default null
)
returns setof public.comment_rows
language sql
stable
security definer
set search_path = public
as $$
  select c.*
  from public.comment_pins p
  join public.comment_rows c on c.id = p.comment_id
  where p.target_id = target
    and p.deleted_at is null
    and c.deleted_at is null
    and (
      num_nonnulls(fragment, cluster, area_start) = 0
      or c.fragment_id = any (public.fragment_set_ids(target, fragment, cluster, area_start, area_end))
    )
$$;

-- =============================================================================
-- Чаты
-- =============================================================================

/** Владелец, создатель и автор последнего сообщения чата — id глазами смотрящего. */
create function public.chat_row_people(p_chat uuid)
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
  select x.owner_id, x.created_by, x.last_message_author_id into c from public.chats x where x.id = p_chat;

  owner_id := public.person_shown_id(c.owner_id, me, p_chat);
  created_by := public.person_shown_id(c.created_by, me, p_chat);
  last_message_author_id := public.person_shown_id(c.last_message_author_id, me, p_chat);
  return next;
end;
$$;

/**
 * Чаты глазами смотрящего. Повторяет SELECT-политику `chats`: живые, а
 * заявку на диалог — только двоим.
 */
create view public.chat_rows as
select
  c.id,
  c.kind,
  c.title,
  c.username,
  c.avatar_url,
  c.description,
  c.request_pending,
  c.subscribers_count,
  c.time_restricted,
  c.created_at,
  c.deleted_at,
  p.owner_id,
  p.created_by,
  p.last_message_author_id
from public.chats c
cross join lateral public.chat_row_people(c.id) p
where c.deleted_at is null
  and (not c.request_pending or auth.uid() = any (c.founding_member_ids));

grant select on public.chat_rows to authenticated;

/**
 * Название чата глазами зрителя: канал, заданное название или люди.
 * Участнику — остальные участники по профильной настройке; постороннему —
 * как в карточке подписчика: у лички — двое (и ещё не принявший), каждый по
 * своей настройке в этом чате, у группы без названия — «Групповой чат».
 */
create function public.chat_title_for(p_chat uuid, p_viewer uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select ch.title from public.channels ch where ch.posts_chat_id = c.id),
    nullif(btrim(c.title), ''),
    (
      select string_agg(
        coalesce((public.person_card(people.person, p_viewer, c.id)).display_name, 'Без имени'),
        case when c.kind = 'direct' then ' и ' else ', ' end
        order by people.rank, people.at
      )
      from (
        select * from (
          select cm.user_id as person, 0 as rank, cm.joined_at as at
          from public.chat_members cm
          where cm.chat_id = c.id and cm.user_id is distinct from p_viewer
          union all
          select i.invitee_id, 1, i.created_at
          from public.chat_invites i
          where i.chat_id = c.id
            and c.kind = 'direct'
            and i.status = 'pending'
            and i.invitee_id is distinct from p_viewer
            and not exists (
              select 1 from public.chat_members me
              where me.chat_id = c.id and me.user_id = p_viewer
            )
        ) everyone
        order by rank, at
        limit case when c.kind = 'direct' then 2 else 3 end
      ) people
      where c.kind = 'direct'
        or exists (select 1 from public.chat_members me where me.chat_id = c.id and me.user_id = p_viewer)
    ),
    case when c.kind = 'group' then 'Групповой чат' else 'Диалог' end
  )
  from public.chats c
  where c.id = p_chat
$$;

create function public.chat_display_name(public.chat_rows)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.chat_title_for($1.id, auth.uid())
$$;

create function public.chat_am_member(public.chat_rows)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.am_chat_member($1.id)
$$;

create function public.chat_read_up_to(public.chat_rows)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select min(cm.last_read_at)
  from public.chat_members cm
  where cm.chat_id = $1.id
    and cm.user_id is distinct from auth.uid()
    and public.chat_reads_visible($1.id)
$$;

create function public.last_message_at(public.chat_rows)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select m.created_at
  from public.messages m
  where m.chat_id = $1.id and m.deleted_at is null and public.chat_time_visible($1.id)
  order by m.seq desc
  limit 1
$$;

/**
 * Превью последнего сообщения глазами смотрящего: сообщение заблокировавшего
 * в чужом чате — заглушка, системная строка состава — с показанными именами.
 */
create function public.chat_preview_for(p_chat uuid, p_viewer uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.chats;
  last record;
  member boolean;
begin
  select * into c from public.chats where id = p_chat;

  if c.id is null then
    return null;
  end if;

  member := exists (select 1 from public.chat_members where chat_id = p_chat and user_id = p_viewer);

  if c.kind <> 'channel_posts'
    and not member
    and public.is_blocked_by(p_viewer, c.last_message_author_id)
  then
    return 'Сообщение скрыто';
  end if;

  select m.system_event, m.author_id, m.system_user_id into last
  from public.messages m
  where m.chat_id = p_chat and m.deleted_at is null
  order by m.seq desc
  limit 1;

  if last.system_event in ('member_invited', 'member_joined', 'member_left', 'member_removed', 'owner_changed') then
    return public.member_event_text(
      last.system_event,
      (public.person_card(last.author_id, p_viewer, p_chat)).display_name,
      (public.person_card(last.system_user_id, p_viewer, p_chat)).display_name
    );
  end if;

  return c.last_message_text;
end;
$$;

create function public.last_message_preview(public.chat_rows)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.chat_preview_for($1.id, auth.uid())
$$;

-- Чтение строки `chats` целиком клиенту больше не доступно: вычисляемые поля
-- таблицы остаются только для серверного кода.
revoke execute on function public.chat_display_name(public.chats) from public, anon, authenticated;
revoke execute on function public.chat_am_member(public.chats) from public, anon, authenticated;
revoke execute on function public.chat_read_up_to(public.chats) from public, anon, authenticated;
revoke execute on function public.last_message_at(public.chats) from public, anon, authenticated;
revoke execute on function public.last_message_preview(public.chats) from public, anon, authenticated;

-- =============================================================================
-- «Ещё не принял»
-- =============================================================================

/** Позванный — глазами смотрящего, в контексте чата заявки. */
create function public.invite_person(p_invite uuid)
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
  select x.invitee_id, x.chat_id into r from public.chat_invites x where x.id = p_invite;

  c := public.person_card(r.invitee_id, auth.uid(), r.chat_id);

  user_id := c.id;
  display_name := c.display_name;
  avatar_url := c.avatar_url;
  username := c.username;
  opaque := coalesce(c.opaque, false);
  return next;
end;
$$;

drop view public.chat_waiting_invitees;

create view public.chat_waiting_invitees as
select
  i.chat_id,
  p.user_id,
  i.created_at as invited_at,
  p.display_name,
  p.avatar_url,
  p.username,
  p.opaque
from public.chat_invites i
cross join lateral public.invite_person(i.id) p
where i.status <> 'accepted'
  and p.user_id is not null
  and public.chat_readable(i.chat_id);

grant select on public.chat_waiting_invitees to authenticated;

-- =============================================================================
-- Права
-- =============================================================================

revoke execute on function public.comment_sent_now(uuid, uuid) from public, anon;
revoke execute on function public.am_chat_member(uuid) from public, anon;
revoke execute on function public.message_people(uuid) from public, anon;
revoke execute on function public.reaction_person(uuid) from public, anon;
revoke execute on function public.comment_people(uuid) from public, anon;
revoke execute on function public.chat_row_people(uuid) from public, anon;
revoke execute on function public.invite_person(uuid) from public, anon;
revoke execute on function public.chat_title_for(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chat_preview_for(uuid, uuid) from public, anon, authenticated;

grant execute on function public.comment_sent_now(uuid, uuid) to authenticated;
grant execute on function public.am_chat_member(uuid) to authenticated;
grant execute on function public.message_people(uuid) to authenticated;
grant execute on function public.reaction_person(uuid) to authenticated;
grant execute on function public.comment_people(uuid) to authenticated;
grant execute on function public.chat_row_people(uuid) to authenticated;
grant execute on function public.invite_person(uuid) to authenticated;
