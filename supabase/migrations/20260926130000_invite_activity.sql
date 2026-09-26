-- Приглашённый узнаёт о новых сообщениях в чате, куда его зовут.
--
-- Первое сообщение создателя работает как приветствие к заявке, а карточка
-- заявки показывает последние сообщения. Участником приглашённый ещё не
-- является, поэтому `new_message` в свой топик не получает, и карточка
-- застывала на «Сообщений пока нет». Отдельное событие `invite_activity`, а не
-- `new_message`: это сигнал обновить карточку, а не повод для всплывающего
-- уведомления о каждом сообщении в чате, куда человек ещё не вступил.
--
-- Только ждущим ответа: отказавшего не беспокоим тем, от чего он отказался.

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
  preview_text text;
begin
  preview_text := case
    when new.text is not null then new.text
    when new.kind = 'media' then '📷 Медиа'
    else new.text
  end;

  update public.chats
  set
    last_message_at = new.created_at,
    last_message_text = preview_text,
    last_message_author_id = new.author_id
  where id = new.chat_id;

  select display_name into author_name from public.profiles where id = new.author_id;

  payload := jsonb_build_object(
    'message_id', new.id,
    'chat_id', new.chat_id,
    'author_id', new.author_id,
    'author_name', author_name,
    'text', preview_text,
    'created_at', new.created_at
  );

  begin
    perform realtime.send(payload, 'new_message', 'chat:' || new.chat_id::text, true);

    for member in
      select user_id from public.chat_members
      where chat_id = new.chat_id and user_id <> new.author_id
    loop
      perform realtime.send(payload, 'new_message', 'user:' || member.user_id::text, true);
    end loop;

    for member in
      select invitee_id as user_id from public.chat_invites
      where chat_id = new.chat_id and status = 'pending' and invitee_id is not null
    loop
      perform realtime.send(
        jsonb_build_object('chat_id', new.chat_id),
        'invite_activity',
        'user:' || member.user_id::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;

  return new;
end;
$$;
