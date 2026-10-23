-- «Изменено» зрителю прячется, только если сообщение правили до публикации
-- задержанного. У обычного сообщения правка в ту же секунду, что отправка
-- (одна транзакция), — тоже правка.

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
    else public.message_seen_text(m.text, m.public_text, s.member)
  end as text,
  m.seq,
  -- Зрителю — время публикации: настоящее выдавало бы задержку и тех, кто
  -- писал после.
  case when t.visible then case when s.member then m.created_at else m.public_at end end as created_at,
  -- Правка до публикации задержанного зрителю не видна: для него сообщение
  -- такое с самого начала. Не задержанное — как раньше.
  case when t.visible and not h.hidden and (s.member or m.public_at <= m.created_at or m.edited_at > m.public_at) then m.edited_at end as edited_at,
  m.edited_at is not null and not h.hidden and (s.member or m.public_at <= m.created_at or m.edited_at > m.public_at) as edited,
  case
    when m.edited_at is not null and not h.hidden and (s.member or m.public_at <= m.created_at or m.edited_at > m.public_at)
      then public.message_edit_count(m.id)
  end as edit_mark,
  case
    when not t.reads or m.read_at is null then null
    when s.member then m.read_at
    else greatest(m.read_at, m.public_at)
  end as read_at,
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
  case when m.stream_id is not null then public.message_stream_host(m.id) end as stream_host_id,
  -- Скрытое автором: участнику — где пометка, зрителю — где замазка.
  case when h.hidden then '[]'::jsonb else public.hidden_ranges_json(m.hidden_ranges) end as hidden_ranges
from public.messages m
cross join lateral public.message_seen(m.id) s
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
  and public.chat_readable(m.chat_id)
  and s.seen;
