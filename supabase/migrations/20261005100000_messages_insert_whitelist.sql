-- Служебные сообщения пишутся только функциями.
--
-- Политика вставки проверяла лишь автора и участие в чате. Участник прямым
-- INSERT через PostgREST мог создать любое сообщение, которое приложение
-- считает служебным: системное «звонок начат» с произвольным текстом
-- (`kind = 'system'`, `stream_id`, `system_event`), пересланный комментарий со
-- ссылкой на удалённый комментарий (`comment_forward` — форма требует лишь
-- непустую ссылку), строку с готовыми счётчиками реакций и комментариев.
--
-- Белый список: напрямую — и через `send_media_message` / `send_voice_message`,
-- они security invoker и идут под этой же политикой — создаётся только
-- обычное сообщение: текст, медиа, голосовое, без служебных колонок, живое и с
-- нулевыми счётчиками. Всё остальное создают функции security definer от
-- владельца таблицы, на них RLS не действует:
--   start_call, finish_stream          — системные о звонке;
--   forward_messages                   — островок пересылки;
--   forward_comments                   — пересланный комментарий;
--   перенос legacy-копий (20261002100000_forward_islands.sql) — разовый, от владельца.
--
-- `edited_at` обнуляет триггер `on_message_inserted_reset_edited_at` до
-- проверки политики. `created_at` с клиента по-прежнему пишется: на нём стоят
-- проверки «в той же транзакции» у вложений и цитат, задним числом к старому
-- сообщению ничего не прицепить.

drop policy "messages can only be sent by chat members" on public.messages;

create policy "messages can only be sent by chat members"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = author_id
    and auth.uid() in (
      select user_id from public.chat_members where chat_id = messages.chat_id
    )
    and kind in ('text', 'media', 'voice')
    and forwarded_comment_id is null
    and source_chat_id is null
    and stream_id is null
    and system_event is null
    and deleted_at is null
    and comments_count = 0
    and reactions_count = 0
    and member_reactions = '{}'::jsonb
    and visitor_reactions = '{}'::jsonb
  );
