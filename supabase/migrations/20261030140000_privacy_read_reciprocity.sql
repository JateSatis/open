-- Прочтение — взаимно: кто скрыл время сообщений от собеседника, тот и сам
-- не видит его отметок прочтения (как в Telegram). Время сообщений при этом
-- видно ему, как раньше: скрывает его чужая настройка, а не своя.
--
-- «Прочтение» здесь — `read_at` сообщения, `last_read_at` участника и
-- `chat_read_up_to`, а также просмотры участников в счётчике: в личке на
-- двоих +1 к просмотрам и есть «прочитано».

/**
 * Видны ли смотрящему отметки прочтения чата: время чата видно ему и его
 * собственная настройка пускает каждого другого участника.
 */
create function public.chat_reads_visible(p_chat uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  mine text;
begin
  if not public.chat_time_visible(p_chat) then
    return false;
  end if;

  if viewer is null then
    return true;
  end if;

  select s.message_activity_metadata_visibility into mine
  from public.privacy_settings s
  where s.user_id = viewer;

  if mine = 'everyone' then
    return true;
  end if;

  return not exists (
    select 1
    from public.chat_members cm
    join public.chats c on c.id = cm.chat_id and c.kind in ('direct', 'group')
    where cm.chat_id = p_chat
      and cm.user_id <> viewer
      and not public.privacy_allows('message_activity_metadata_visibility', viewer, cm.user_id)
  );
end;
$$;

revoke execute on function public.chat_reads_visible(uuid) from public, anon;
grant execute on function public.chat_reads_visible(uuid) to authenticated;

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
  t.visible as time_visible
from public.messages m
cross join lateral (
  select
    public.chat_time_visible(m.chat_id) as visible,
    public.chat_reads_visible(m.chat_id) as reads
) t
where m.deleted_at is null;

create or replace function public.chat_read_up_to(public.chats)
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
  select
    cm.chat_id,
    cm.user_id,
    p.display_name,
    p.avatar_url,
    p.username,
    case when v.reads then cm.last_read_at end,
    case when v.visible then cm.joined_at end,
    (row_number() over (partition by cm.chat_id order by cm.joined_at, cm.user_id) - 1)::int
  from public.chat_members cm
  join public.chats c on c.id = cm.chat_id and c.deleted_at is null
  left join public.profiles p on p.id = cm.user_id
  cross join lateral (
    select
      public.chat_time_visible(cm.chat_id) as visible,
      public.chat_reads_visible(cm.chat_id) as reads
  ) v
  where cm.chat_id = any (chat_ids)
  order by cm.chat_id, cm.joined_at, cm.user_id;
end;
$$;
