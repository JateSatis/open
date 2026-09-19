-- Личные диалоги: открытие чата с человеком, состояние прочтения и доставка
-- сообщений через Realtime Broadcast, порождаемый самой базой.
--
-- Почему broadcast из базы, а не из клиента: доставка не должна зависеть от
-- того, дожил ли отправитель до момента после вставки. Триггер срабатывает в
-- той же транзакции, что и сообщение, поэтому получатель узнаёт о нём, даже
-- если приложение отправителя закрылось сразу после отправки.

-- =============================================================================
-- Денормализованное последнее сообщение чата
-- =============================================================================
--
-- Список чатов рисуется одним запросом: тянуть последнее сообщение отдельным
-- запросом на каждый чат — это N+1, который растёт вместе с числом диалогов.

alter table public.chats
  add column last_message_at timestamptz,
  add column last_message_text text,
  add column last_message_author_id uuid references public.profiles (id) on delete set null;

create index chats_last_message_at_idx on public.chats (last_message_at desc nulls last);

update public.chats c
set
  last_message_at = m.created_at,
  last_message_text = m.text,
  last_message_author_id = m.author_id
from (
  select distinct on (chat_id) chat_id, created_at, text, author_id
  from public.messages
  where deleted_at is null
  order by chat_id, created_at desc
) m
where m.chat_id = c.id;

-- =============================================================================
-- Состояние прочтения
-- =============================================================================
--
-- Отметка хранится на участнике, а не на каждом сообщении: для диалога этого
-- достаточно, чтобы ответить на оба вопроса — «есть ли непрочитанное у меня»
-- и «прочитал ли собеседник моё сообщение», — и не плодить строку на каждую
-- пару «сообщение-читатель».

alter table public.chat_members
  add column last_read_at timestamptz not null default now();

create policy "chat_members can mark their own row read"
  on public.chat_members for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================================
-- Открытие диалога с человеком
-- =============================================================================
--
-- security definer, потому что вставка второго участника упирается в политику
-- chat_members: проверка «я уже состою в этом чате» читает ту же таблицу, на
-- которую наложена, и Postgres отвергает такую рекурсию. Функция обходит RLS,
-- но сама проверяет, что вызывающий создаёт диалог от своего имени.

create function public.get_or_create_direct_chat(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  found_chat uuid;
begin
  if me is null then
    raise exception 'Требуется аутентификация';
  end if;

  if me = other_user_id then
    raise exception 'Нельзя начать диалог с самим собой';
  end if;

  if not exists (select 1 from public.profiles where id = other_user_id and deleted_at is null) then
    raise exception 'Пользователь не найден';
  end if;

  -- Блокировка на пару пользователей: два одновременных открытия одного и того
  -- же диалога иначе создадут два чата, и переписка разъедется по ним.
  perform pg_advisory_xact_lock(
    hashtextextended(
      least(me::text, other_user_id::text) || greatest(me::text, other_user_id::text), 0
    )
  );

  select c.id into found_chat
  from public.chats c
  where c.kind = 'direct'
    and c.deleted_at is null
    and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = me)
    and exists (
      select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = other_user_id
    )
    and (select count(*) from public.chat_members m where m.chat_id = c.id) = 2
  limit 1;

  if found_chat is not null then
    return found_chat;
  end if;

  insert into public.chats (kind, created_by) values ('direct', me) returning id into found_chat;

  insert into public.chat_members (chat_id, user_id)
  values (found_chat, me), (found_chat, other_user_id);

  return found_chat;
end;
$$;

grant execute on function public.get_or_create_direct_chat(uuid) to authenticated;

-- =============================================================================
-- Broadcast о новом сообщении
-- =============================================================================

create function public.broadcast_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  member record;
begin
  update public.chats
  set
    last_message_at = new.created_at,
    last_message_text = new.text,
    last_message_author_id = new.author_id
  where id = new.chat_id;

  payload := jsonb_build_object(
    'message_id', new.id,
    'chat_id', new.chat_id,
    'author_id', new.author_id,
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

create trigger on_message_created
  after insert on public.messages
  for each row execute function public.broadcast_new_message();

-- =============================================================================
-- Broadcast о прочтении
-- =============================================================================
--
-- Без него галочка «прочитано» у отправителя обновлялась бы только при
-- повторном заходе в чат.

create function public.broadcast_read_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.last_read_at is not distinct from old.last_read_at then
    return new;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object(
        'chat_id', new.chat_id,
        'user_id', new.user_id,
        'last_read_at', new.last_read_at
      ),
      'read',
      'chat:' || new.chat_id::text,
      true
    );
  exception
    when others then null;
  end;

  return new;
end;
$$;

create trigger on_chat_member_read
  after update on public.chat_members
  for each row execute function public.broadcast_read_state();

-- =============================================================================
-- Доступ к приватным каналам Realtime
-- =============================================================================
--
-- Топик чата открыт всем аутентифицированным — переписка в Open публична, и
-- канал не должен обещать приватности, которой нет. Личный топик доступен
-- только своему владельцу: это не тайна переписки, а защита от чужих
-- уведомлений в своём интерфейсе.

create policy "chat and own user broadcasts are readable"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() like 'chat:%'
    or realtime.topic() = 'user:' || auth.uid()::text
  );

-- Клиент пишет в топик чата только эфемерные события вроде «печатает»:
-- сообщения в канал кладёт триггер, а не клиент.
create policy "typing can be broadcast to chat topics"
  on realtime.messages for insert
  to authenticated
  with check (realtime.topic() like 'chat:%');
