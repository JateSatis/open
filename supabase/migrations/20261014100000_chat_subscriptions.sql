-- Подписки на чужие диалоги и группы, этап 2.
--
-- Цель подписки — теперь и чат: снимается проверка `subscriptions_channels_only`
-- из 20261013100000_channel_subscriptions.sql. Подписка на чат — один уровень:
-- подписан = чат в «Чатах», поэтому `in_chats` у неё всегда true, и это держит
-- база, а не клиент. Два уровня у чатов появятся вместе с лентой — тогда
-- проверка `subscriptions_chat_in_chats` снимается так же, как сейчас
-- снимается канальная.
--
-- Подписчик чата, как и канала, никогда не становится строкой `chat_members`:
-- центральная политика на `messages` пустила бы его писать. Всё его — в
-- `subscriptions`: непрочитанное (`messages_read_at`), карточки (`notify`).
--
-- Функции — парные к канальным (`*_chat`), а не обобщённые «канал | чат»:
-- у канала два уровня подписки, попсы и право по `can_publish_in_channel`, у
-- чата — ничего этого, и общий аргумент «одно из двух» сделал бы каждую
-- функцию веткой на два случая без общей части. Общее — только список
-- подписок в «Чатах»: его отдаёт одна функция `my_subscriptions`.

-- =============================================================================
-- Схема
-- =============================================================================

alter table public.subscriptions
  drop constraint subscriptions_channels_only,
  add constraint subscriptions_chat_in_chats check (chat_id is null or in_chats);

-- Индекс по чату заменяется составным: им же пользуются список подписчиков
-- чата (свежие сверху) и рассылка о новом сообщении.
drop index public.subscriptions_chat_id_idx;

create index subscriptions_chat_created_idx
  on public.subscriptions (chat_id, created_at desc, id desc)
  where chat_id is not null;

alter table public.chats add column subscribers_count int not null default 0;

/**
 * Цель — только живой личный диалог или группа. Чат постов канала — отказ:
 * на канал подписываются через канал, и его подписка — строка с `channel_id`.
 * Пишут в таблицу только функции, но инвариант держит триггер: функция могла
 * бы ошибиться, а подписка на чат постов сломала бы и «Чаты», и счётчики.
 */
create function public.guard_chat_subscription()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.chat_id is not null and not exists (
    select 1 from public.chats c
    where c.id = new.chat_id and c.kind in ('direct', 'group') and c.deleted_at is null
  ) then
    raise exception 'Подписаться можно только на диалог или группу' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_chat_subscription() from public, anon, authenticated;

create trigger subscriptions_guard_chat
  before insert or update of chat_id on public.subscriptions
  for each row execute function public.guard_chat_subscription();

-- Счётчик подписчиков — и на канале, и на чате. Та же функция, что в
-- 20261013100000_channel_subscriptions.sql, плюс ветки чата.
create or replace function public.count_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.channel_id is not null then
      update public.channels
      set subscribers_count = subscribers_count + 1,
          readers_count = readers_count + new.in_chats::int
      where id = new.channel_id;
    else
      update public.chats set subscribers_count = subscribers_count + 1 where id = new.chat_id;
    end if;
  elsif tg_op = 'DELETE' then
    if old.channel_id is not null then
      update public.channels
      set subscribers_count = greatest(subscribers_count - 1, 0),
          readers_count = greatest(readers_count - old.in_chats::int, 0)
      where id = old.channel_id;
    else
      update public.chats
      set subscribers_count = greatest(subscribers_count - 1, 0)
      where id = old.chat_id;
    end if;
  elsif new.channel_id is not null and old.in_chats is distinct from new.in_chats then
    update public.channels
    set readers_count = greatest(readers_count + case when new.in_chats then 1 else -1 end, 0)
    where id = new.channel_id;
  end if;

  return null;
end;
$$;

/**
 * Подписчик, ставший участником (принял заявку), теряет подписку: иначе чат
 * задвоился бы в «Чатах», а счётчик считал бы участника подписчиком. Выйдя
 * из чата (когда выход появится), человек подписчиком сам не становится —
 * подписаться заново он может как любой посторонний.
 */
create function public.drop_subscription_of_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.subscriptions
  where chat_id = new.chat_id and subscriber_id = new.user_id;

  return null;
end;
$$;

revoke execute on function public.drop_subscription_of_new_member() from public, anon, authenticated;

create trigger chat_members_drop_subscription
  after insert on public.chat_members
  for each row execute function public.drop_subscription_of_new_member();

-- =============================================================================
-- Мои подписки в «Чатах»: каналы и чаты одной выборкой
-- =============================================================================

/**
 * Мои подписки с непрочитанным. Без аргумента — все, что в «Чатах» (список
 * чатов): каналы-читатели и подписанные чаты. С чатом — подписка на этот чат
 * или на канал этого чата постов, в чатах она или нет (экран переписки).
 * `channel_id` у подписки на чат — null, попсов у чата нет.
 */
create function public.my_subscriptions(target_chat uuid default null)
returns table (
  channel_id uuid,
  chat_id uuid,
  in_chats boolean,
  notify boolean,
  unread_posts int,
  unread_pops int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.channel_id,
    ch.posts_chat_id,
    s.in_chats,
    s.notify,
    public.subscription_unread_messages(ch.posts_chat_id, s.messages_read_at, s.subscriber_id),
    public.subscription_unread_pops(ch.id, s.pops_read_at, s.subscriber_id)
  from public.subscriptions s
  join public.channels ch on ch.id = s.channel_id and ch.deleted_at is null
  where s.subscriber_id = auth.uid()
    and case when target_chat is null then s.in_chats else ch.posts_chat_id = target_chat end
  union all
  select
    null::uuid,
    s.chat_id,
    s.in_chats,
    s.notify,
    public.subscription_unread_messages(s.chat_id, s.messages_read_at, s.subscriber_id),
    0
  from public.subscriptions s
  join public.chats c on c.id = s.chat_id and c.deleted_at is null
  where s.subscriber_id = auth.uid()
    and (target_chat is null or s.chat_id = target_chat)
$$;

revoke execute on function public.my_subscriptions(uuid) from public, anon;
grant execute on function public.my_subscriptions(uuid) to authenticated;

-- =============================================================================
-- Подписка на чат: подписаться, уведомления, отписаться, прочитать
-- =============================================================================

/**
 * Подписаться на чужой диалог или группу. Повтор — не ошибка. Участник
 * подписаться не может: чат у него и так в «Чатах», а писать подписка не даёт.
 * Подписка начинается с прочитанного: старые сообщения новыми не становятся.
 */
create function public.subscribe_to_chat(target_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles where id = me and deleted_at is null) then
    raise exception 'Профиль удалён' using errcode = '42501';
  end if;

  if not exists (select 1 from public.chats where id = target_chat and deleted_at is null) then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.chat_members where chat_id = target_chat and user_id = me) then
    raise exception 'На свой чат не подписываются' using errcode = '42501';
  end if;

  -- Чат постов канала отвергает триггер `subscriptions_guard_chat`.
  insert into public.subscriptions (subscriber_id, chat_id, in_chats)
  values (me, target_chat, true)
  on conflict (subscriber_id, chat_id) where chat_id is not null do nothing;
end;
$$;

revoke execute on function public.subscribe_to_chat(uuid) from public, anon;
grant execute on function public.subscribe_to_chat(uuid) to authenticated;

/** Карточки о новых сообщениях чата. Подписки нет — P0002. */
create function public.set_chat_notifications(target_chat uuid, enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  update public.subscriptions
  set notify = coalesce(enabled, true)
  where subscriber_id = auth.uid() and chat_id = target_chat;

  if not found then
    raise exception 'Подписки нет' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_chat_notifications(uuid, boolean) from public, anon;
grant execute on function public.set_chat_notifications(uuid, boolean) to authenticated;

/** Отписаться от чата. Подписки и так нет — не ошибка. */
create function public.unsubscribe_from_chat(target_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  delete from public.subscriptions
  where subscriber_id = auth.uid() and chat_id = target_chat;
end;
$$;

revoke execute on function public.unsubscribe_from_chat(uuid) from public, anon;
grant execute on function public.unsubscribe_from_chat(uuid) to authenticated;

/**
 * Отметка прочтения подписчика чата — временем сервера. Отметки участников
 * (`chat_members.last_read_at`, `messages.read_at`) не трогает: галочки
 * «прочитано» в облачках — только от участников. Не подписан — молча.
 */
create function public.mark_chat_subscription_read(target_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  update public.subscriptions
  set messages_read_at = now()
  where subscriber_id = auth.uid() and chat_id = target_chat;
end;
$$;

revoke execute on function public.mark_chat_subscription_read(uuid) from public, anon;
grant execute on function public.mark_chat_subscription_read(uuid) to authenticated;

/**
 * Подписчики чата, свежие сверху, страницами по ключу (время, id). Видят
 * только участники: кто на что подписан — приватное, остальным — число на чате.
 */
create function public.list_chat_subscribers(
  target_chat uuid,
  before_created timestamptz default null,
  before_id uuid default null,
  page_size int default 30
)
returns table (
  id uuid,
  subscriber_id uuid,
  display_name text,
  username text,
  avatar_url text,
  subscribed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.chat_members cm
    where cm.chat_id = target_chat and cm.user_id = auth.uid()
  ) then
    raise exception 'Подписчиков видят только участники чата' using errcode = '42501';
  end if;

  return query
  select s.id, s.subscriber_id, p.display_name, p.username, p.avatar_url, s.created_at
  from public.subscriptions s
  join public.profiles p on p.id = s.subscriber_id and p.deleted_at is null
  where s.chat_id = target_chat
    and (before_created is null or (s.created_at, s.id) < (before_created, before_id))
  order by s.created_at desc, s.id desc
  limit least(greatest(coalesce(page_size, 30), 1), 100);
end;
$$;

revoke execute on function public.list_chat_subscribers(uuid, timestamptz, uuid, int) from public, anon;
grant execute on function public.list_chat_subscribers(uuid, timestamptz, uuid, int) to authenticated;

-- =============================================================================
-- События подписчикам чата: новое сообщение
-- =============================================================================
--
-- Та же функция, что в 20261013100000_channel_subscriptions.sql, плюс цикл по
-- подписчикам чата: им `new_message` в `user:<id>` — чтобы чат поднялся в
-- «Чатах» и пришла карточка. В событии — `notify` (карточку клиент показывает
-- только при нём) и `chat_title` — название глазами постороннего, «Аня и
-- Пётр»: карточка подписчика подписана перепиской, а не автором.
--
-- Долг тот же, что у читателей канала: рассылка циклом внутри триггера,
-- время вставки сообщения растёт с числом подписчиков. На единицах и десятках
-- незаметно; на тысячах рассылка переезжает в очередь (pg_net / Edge Function
-- пачками) или в общий топик чата, который клиент подписчика слушает сам.

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
  posts_channel public.channels;
  outsider_title text;
begin
  preview_text := public.message_preview_text(new);

  update public.chats
  set
    last_message_at = new.created_at,
    last_message_text = preview_text,
    last_message_author_id = new.author_id
  where id = new.chat_id;

  select display_name into author_name from public.profiles where id = new.author_id;
  select * into posts_channel from public.channels where posts_chat_id = new.chat_id;

  payload := jsonb_build_object(
    'message_id', new.id,
    'chat_id', new.chat_id,
    'author_id', new.author_id,
    'author_name', author_name,
    'kind', new.kind,
    'text', preview_text,
    'created_at', new.created_at
  );

  -- Пост подписан каналом, а не человеком, который его опубликовал.
  if posts_channel.id is not null then
    payload := payload || jsonb_build_object(
      'channel_id', posts_channel.id,
      'channel_title', posts_channel.title,
      'channel_avatar_url', posts_channel.avatar_url
    );
  end if;

  begin
    perform realtime.send(payload, 'new_message', 'chat:' || new.chat_id::text, true);

    for member in
      select user_id from public.chat_members
      where chat_id = new.chat_id and user_id is distinct from new.author_id
    loop
      perform realtime.send(payload, 'new_message', 'user:' || member.user_id::text, true);
    end loop;

    if posts_channel.id is not null then
      for member in
        select subscriber_id, notify from public.subscriptions
        where channel_id = posts_channel.id and in_chats
          and subscriber_id is distinct from new.author_id
      loop
        perform realtime.send(
          payload || jsonb_build_object('notify', member.notify),
          'new_message',
          'user:' || member.subscriber_id::text,
          true
        );
      end loop;
    elsif exists (select 1 from public.subscriptions where chat_id = new.chat_id) then
      -- Название — как его видит посторонний: у группы своё, у диалога —
      -- оба участника в порядке вступления (так же собирает его клиент).
      select coalesce(
        nullif(btrim(c.title), ''),
        (
          select string_agg(coalesce(p.display_name, 'Без имени'), case when c.kind = 'direct' then ' и ' else ', ' end order by cm.joined_at)
          from public.chat_members cm
          join public.profiles p on p.id = cm.user_id
          where cm.chat_id = c.id
        ),
        case when c.kind = 'group' then 'Групповой чат' else 'Диалог' end
      )
      into outsider_title
      from public.chats c
      where c.id = new.chat_id;

      for member in
        select subscriber_id, notify from public.subscriptions
        where chat_id = new.chat_id
      loop
        perform realtime.send(
          payload || jsonb_build_object('notify', member.notify, 'chat_title', outsider_title),
          'new_message',
          'user:' || member.subscriber_id::text,
          true
        );
      end loop;
    end if;

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
