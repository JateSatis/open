-- Скрытый текст и задержка: правки после проверки.
--
-- * Политика чтения `messages` не ищет строку по id: при вставке с
--   RETURNING новой строки ещё не видно в снимке функции, и участнику
--   отказывали. Видимость — по колонкам самой строки: участник видит всё,
--   остальные — то, чьё время публикации наступило (оно не меньше, чем у
--   любого неопубликованного перед ним).

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
    and (public_at <= now() or public.am_chat_member(chat_id))
  );
