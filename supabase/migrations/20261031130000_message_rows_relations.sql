-- Связи `message_rows` для PostgREST.
--
-- Представление из 20261031120000_privacy_blocks_visibility.sql соединяло
-- `messages` с `chats` и прятало внешние ключи заглушки выражениями — и
-- PostgREST перестал выводить связи представления: вложения, звонок,
-- исходный чат островка, пересланный комментарий (PGRST200 на выборке
-- переписки). Связи представления он выводит только по колонкам, которые
-- ссылаются на колонки таблицы напрямую, из одного источника.
--
-- Теперь: один источник (`messages`), внешние ключи — как есть (и `kind`:
-- вложения ссылаются на сообщение составным ключом `(id, kind)`), видимость
-- заявки — условием в `where`, заглушка — только в колонках без связей.
-- У заглушки остаются вид, `stream_id`, `source_chat_id`,
-- `forwarded_comment_id`: клиент рисует облачко-заглушку по `hidden` и
-- связанное не показывает; вложения скрывает политика `attachments` (через
-- `messages`), текст — само представление.

create or replace view public.message_rows as
select
  m.id,
  m.chat_id,
  m.author_id,
  m.kind,
  case when h.hidden then null else m.text end as text,
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
  m.system_user_id,
  m.source_chat_id,
  m.forwarded_comment_id,
  t.visible as time_visible,
  t.reads as reads_visible,
  h.hidden
from public.messages m
cross join lateral public.chat_visibility(m.chat_id) t
cross join lateral (
  select case
    when m.author_id = any ((select public.my_blockers())::uuid[]) and m.kind <> 'system'
      then not public.blocker_message_visible(m.chat_id)
    else false
  end as hidden
) h
where m.deleted_at is null
  and public.chat_readable(m.chat_id);
