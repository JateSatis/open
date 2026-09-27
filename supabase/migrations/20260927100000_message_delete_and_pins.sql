-- Удаление сообщений для всех и закреплённые сообщения.
--
-- Удаление мягкое: строка остаётся с `deleted_at`, потому что на неё могут
-- ссылаться фрагменты ленты, клипы, а позже и ответы. Обычная выборка
-- удалённое не отдаёт (SELECT-политика `deleted_at is null`), но факт
-- удаления по id узнать можно — через `message_tombstones`.
--
-- Удалить можно только своё. Прямой UPDATE `deleted_at` для этого не годится:
-- Postgres не даёт обновить строку так, чтобы она перестала быть видимой по
-- SELECT-политике, — поэтому удаление идёт функцией, которая сама проверяет
-- автора.

-- =============================================================================
-- Превью сообщения одной строкой
-- =============================================================================
--
-- Нужно в двух местах: при новом сообщении и при откате превью на предыдущее
-- живое, когда последнее удалили. Правило одно, поэтому и функция одна.

create function public.message_preview_text(m public.messages)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  voice_ms int;
begin
  if m.text is not null then
    return m.text;
  end if;

  if m.kind = 'media' then
    return '📷 Медиа';
  end if;

  if m.kind = 'voice' then
    select duration_ms into voice_ms
    from public.attachments
    where message_id = m.id
    limit 1;

    -- Та же запись, что у `formatDuration` на клиенте: m:ss, секунды вниз, но
    -- не меньше одной — «0:00» у отправленного голосового выглядит поломкой.
    if voice_ms is not null then
      return format(
        '🎤 Голосовое сообщение (%s:%s)',
        greatest(voice_ms / 1000, 1) / 60,
        lpad((greatest(voice_ms / 1000, 1) % 60)::text, 2, '0')
      );
    end if;

    return '🎤 Голосовое сообщение';
  end if;

  return m.text;
end;
$$;

revoke execute on function public.message_preview_text(public.messages) from public, anon;

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
  preview_text := public.message_preview_text(new);

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

-- =============================================================================
-- Закреплённые сообщения
-- =============================================================================
--
-- Закреплять и откреплять может любой участник чата, закрепов несколько.
-- Открепление — мягкое, как и всё в схеме: строка получает `deleted_at`.
--
-- Инварианты — в схеме: сообщение из другого чата не закрепляется (составной
-- внешний ключ на пару id + chat_id), одно сообщение не закрепляется дважды
-- (частичный уникальный индекс по живым закрепам).

alter table public.messages
  add constraint messages_id_chat_id_key unique (id, chat_id);

create table public.message_pins (
  id uuid primary key default gen_random_uuid (),
  chat_id uuid not null references public.chats (id) on delete cascade,
  message_id uuid not null,
  pinned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (message_id, chat_id) references public.messages (id, chat_id) on delete cascade
);

create unique index message_pins_active_message_key
  on public.message_pins (message_id)
  where deleted_at is null;

create index message_pins_chat_id_idx
  on public.message_pins (chat_id)
  where deleted_at is null;

alter table public.message_pins enable row level security;

-- Полосу закрепов видит и посетитель: переписка публична, закрепы — её часть.
create policy "message_pins are readable by authenticated users"
  on public.message_pins for select
  to authenticated
  using (deleted_at is null);

-- Прямая вставка остаётся под теми же правилами, что и функция: только
-- участник, от своего имени, только живое сообщение. Подзапрос к `messages`
-- идёт под её RLS и удалённое сообщение не находит.
create policy "message_pins can be added by chat members"
  on public.message_pins for insert
  to authenticated
  with check (
    auth.uid() = pinned_by
    and exists (
      select 1 from public.chat_members
      where chat_members.chat_id = message_pins.chat_id
        and chat_members.user_id = auth.uid()
    )
    and exists (
      select 1 from public.messages
      where messages.id = message_pins.message_id
        and messages.chat_id = message_pins.chat_id
    )
  );

-- UPDATE и DELETE политик нет: открепление — только функцией `unpin_message`.

create function public.pin_message(target_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target_chat uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- for share: удаление того же сообщения в параллельной транзакции ждёт,
  -- пока закреп не ляжет, и затем снимает его вместе с сообщением.
  select chat_id into target_chat
  from public.messages
  where id = target_message and deleted_at is null
  for share;

  if target_chat is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.chat_members
    where chat_id = target_chat and user_id = caller
  ) then
    raise exception 'only chat members can pin messages' using errcode = '42501';
  end if;

  insert into public.message_pins (chat_id, message_id, pinned_by)
  values (target_chat, target_message, caller)
  on conflict (message_id) where deleted_at is null do nothing;
end;
$$;

revoke execute on function public.pin_message(uuid) from public, anon;
grant execute on function public.pin_message(uuid) to authenticated;

create function public.unpin_message(target_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target_chat uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select chat_id into target_chat from public.messages where id = target_message;

  if target_chat is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.chat_members
    where chat_id = target_chat and user_id = caller
  ) then
    raise exception 'only chat members can unpin messages' using errcode = '42501';
  end if;

  update public.message_pins
  set deleted_at = now()
  where message_id = target_message and deleted_at is null;
end;
$$;

revoke execute on function public.unpin_message(uuid) from public, anon;
grant execute on function public.unpin_message(uuid) to authenticated;

-- Сигнал в топик чата: полоса закрепов у всех, кто смотрит чат, перечитывает
-- список. Payload — только сигнал, сами закрепы клиент берёт из базы.
create function public.broadcast_pins_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('chat_id', new.chat_id),
      'pins_changed',
      'chat:' || new.chat_id::text,
      true
    );
  exception
    when others then null;
  end;

  return new;
end;
$$;

create trigger on_message_pins_changed
  after insert or update on public.message_pins
  for each row execute function public.broadcast_pins_changed();

-- =============================================================================
-- Удаление сообщений
-- =============================================================================

create index messages_chat_id_deleted_at_idx
  on public.messages (chat_id, deleted_at)
  where deleted_at is not null;

/**
 * Удаляет пачку своих сообщений одного чата для всех. Чужое сообщение в
 * пачке отвергает всю пачку: удалить «что получится» было бы хуже, чем
 * не удалить ничего и честно сказать об ошибке.
 */
create function public.delete_messages(message_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  wanted int;
  found int;
  foreign_count int;
  chat_count int;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  wanted := coalesce(cardinality(array(select distinct unnest(message_ids))), 0);

  if wanted = 0 then
    return;
  end if;

  if wanted > 500 then
    raise exception 'too many messages in one call' using errcode = '22023';
  end if;

  perform 1 from public.messages where id = any (message_ids) for update;

  select
    count(*),
    count(*) filter (where author_id is distinct from caller),
    count(distinct chat_id)
  into found, foreign_count, chat_count
  from public.messages
  where id = any (message_ids);

  if found <> wanted then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if foreign_count > 0 then
    raise exception 'only own messages can be deleted' using errcode = '42501';
  end if;

  if chat_count > 1 then
    raise exception 'messages belong to different chats' using errcode = '22023';
  end if;

  -- Уже удалённые в пачке не мешают: повтор той же просьбы — не ошибка.
  update public.messages
  set deleted_at = now()
  where id = any (message_ids) and deleted_at is null;
end;
$$;

revoke execute on function public.delete_messages(uuid[]) from public, anon;
grant execute on function public.delete_messages(uuid[]) to authenticated;

/**
 * Какие из этих сообщений удалены. Отдаёт только id и время удаления —
 * содержимое удалённого остаётся закрытым. Нужна клиенту, чтобы дочитать
 * пропущенные удаления после обрыва Realtime и отличить «удалено» от «нет
 * такого» (например, у цитаты в ответе).
 */
create function public.message_tombstones(message_ids uuid[])
returns table (id uuid, deleted_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if cardinality(message_ids) > 1000 then
    raise exception 'too many messages in one call' using errcode = '22023';
  end if;

  return query
    select m.id, m.deleted_at
    from public.messages m
    where m.id = any (message_ids) and m.deleted_at is not null;
end;
$$;

revoke execute on function public.message_tombstones(uuid[]) from public, anon;
grant execute on function public.message_tombstones(uuid[]) to authenticated;

/**
 * Что происходит после удаления, кем бы оно ни было сделано: снимаются
 * закрепы удалённых сообщений, превью чата откатывается на предыдущее живое
 * сообщение и все, кто смотрит чат, получают сигнал. На уровне оператора, а
 * не строки: пачка из десяти сообщений — одно событие, а не десять.
 */
create function public.handle_messages_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected record;
  last_live public.messages;
  preview_changed boolean;
  member record;
begin
  for affected in
    select n.chat_id, array_agg(n.id) as ids, max(n.created_at) as newest
    from new_rows n
    join old_rows o on o.id = n.id
    where o.deleted_at is null and n.deleted_at is not null
    group by n.chat_id
  loop
    update public.message_pins
    set deleted_at = now()
    where message_id = any (affected.ids) and deleted_at is null;

    -- Превью трогаем, только если удалённое могло в нём стоять.
    select coalesce(last_message_at <= affected.newest, false) into preview_changed
    from public.chats
    where id = affected.chat_id;

    if preview_changed then
      select * into last_live
      from public.messages
      where chat_id = affected.chat_id and deleted_at is null
      order by created_at desc
      limit 1;

      update public.chats
      set
        last_message_at = last_live.created_at,
        last_message_text = case
          when last_live.id is null then null
          else public.message_preview_text(last_live)
        end,
        last_message_author_id = last_live.author_id
      where id = affected.chat_id;
    end if;

    begin
      perform realtime.send(
        jsonb_build_object('chat_id', affected.chat_id, 'message_ids', to_jsonb(affected.ids)),
        'messages_deleted',
        'chat:' || affected.chat_id::text,
        true
      );

      if preview_changed then
        for member in
          select user_id from public.chat_members where chat_id = affected.chat_id
        loop
          perform realtime.send(
            jsonb_build_object('chat_id', affected.chat_id),
            'chat_changed',
            'user:' || member.user_id::text,
            true
          );
        end loop;

        for member in
          select invitee_id as user_id from public.chat_invites
          where chat_id = affected.chat_id and status = 'pending' and invitee_id is not null
        loop
          perform realtime.send(
            jsonb_build_object('chat_id', affected.chat_id),
            'invite_activity',
            'user:' || member.user_id::text,
            true
          );
        end loop;
      end if;
    exception
      when others then null;
    end;
  end loop;

  return null;
end;
$$;

create trigger on_messages_deleted
  after update on public.messages
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.handle_messages_deleted();
