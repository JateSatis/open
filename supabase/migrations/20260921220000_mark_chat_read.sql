-- Отметка прочтения ставится временем сервера, а не клиента.
--
-- Сообщения получают created_at из базы, а отметку раньше писал клиент своим
-- временем. Часы устройства почти всегда расходятся с серверными — на
-- эмуляторе разница доходила до десятка секунд, — и сообщение, пришедшее
-- «позже» отметки, навсегда оставалось непрочитанным: у получателя висел
-- кружок, у отправителя — «доставлено» вместо «прочитано».
--
-- security invoker: политика chat_members разрешает менять только свою строку,
-- и эта функция обязана подчиняться ей, а не обходить.

create function public.mark_chat_read(target_chat uuid)
returns timestamptz
language sql
security invoker
set search_path = public
as $$
  update public.chat_members
  set last_read_at = now()
  where chat_id = target_chat and user_id = auth.uid()
  returning last_read_at;
$$;

grant execute on function public.mark_chat_read(uuid) to authenticated;
