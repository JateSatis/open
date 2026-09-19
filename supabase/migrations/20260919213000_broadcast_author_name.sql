-- Имя отправителя в полезной нагрузке рассылки.
--
-- Всплывающее уведомление показывает, кто написал. Без имени в payload клиент
-- ходил бы за профилем на каждое входящее сообщение — лишний запрос ровно в
-- тот момент, когда пользователь занят чем-то другим.

create or replace function public.broadcast_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  member record;
  author_name text;
begin
  update public.chats
  set
    last_message_at = new.created_at,
    last_message_text = new.text,
    last_message_author_id = new.author_id
  where id = new.chat_id;

  select display_name into author_name from public.profiles where id = new.author_id;

  payload := jsonb_build_object(
    'message_id', new.id,
    'chat_id', new.chat_id,
    'author_id', new.author_id,
    'author_name', author_name,
    'text', new.text,
    'created_at', new.created_at
  );

  -- Сообщение обязано сохраниться, даже если Realtime недоступен: падение
  -- рассылки не должно превращаться в «не отправилось» у пользователя.
  begin
    perform realtime.send(payload, 'new_message', 'chat:' || new.chat_id::text, true);

    -- Личный топик каждого участника, кроме автора: по нему приложение
    -- показывает уведомление, находясь на любом экране.
    for member in
      select user_id from public.chat_members
      where chat_id = new.chat_id and user_id <> new.author_id
    loop
      perform realtime.send(payload, 'new_message', 'user:' || member.user_id::text, true);
    end loop;
  exception
    when others then null;
  end;

  return new;
end;
$$;
