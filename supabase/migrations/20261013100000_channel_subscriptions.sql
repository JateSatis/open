-- Подписки на каналы, этап 1.
--
-- Подписчик — кто подписался на канал; читатель — подписчик, который ещё и
-- держит канал в «Чатах» (`in_chats`). Подписка — строка «человек + цель»,
-- приватная, как `devices` и `chat_members`: свою видит только сам подписчик,
-- чужие — никто, кроме создателя канала, и то через функцию списка.
--
-- Подписчик никогда не становится строкой `chat_members` чата постов:
-- центральная политика на `messages` пустила бы его писать посты. Всё, что
-- подписчику нужно от чата (непрочитанное, отметки прочтения, события в
-- `user:<id>`), живёт в этой таблице и функциях вокруг неё.
--
-- Этап 2 (подписка на чужие диалоги и группы) ложится сюда же: цель — ровно
-- одно из канала или чата, как у `handles` и `comments`. Сейчас чат как цель
-- запрещён отдельной проверкой — её снятие и есть этап 2 для схемы.
--
-- Отписка удаляет строку физически. Мягкое удаление в Open — ради публичного
-- контента, на который ссылаются фрагменты ленты и клипы; на подписку не
-- ссылается ничего, а держать «мёртвые» строки значило бы усложнять
-- уникальность и каждый запрос по таблице ради истории, которую никто не
-- читает. Так же устроены `chat_members` и `devices`.

-- =============================================================================
-- subscriptions
-- =============================================================================

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subscriber_id uuid not null references public.profiles (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete cascade,
  chat_id uuid references public.chats (id) on delete cascade,
  -- Читатель: канал лежит в «Чатах» с непрочитанным.
  in_chats boolean not null default false,
  -- Карточки внутри приложения о новом посте и попсе. Без `in_chats` их нет
  -- независимо от флага: событий подписчику без чатов база не шлёт.
  notify boolean not null default true,
  -- Отметки прочтения — временем сервера, как у `mark_chat_read`. Подписка
  -- начинается с прочитанного: старые посты канала новыми не становятся.
  messages_read_at timestamptz not null default now(),
  pops_read_at timestamptz not null default now(),
  constraint subscriptions_single_target check (num_nonnulls(channel_id, chat_id) = 1),
  constraint subscriptions_channels_only check (chat_id is null)
);

create unique index subscriptions_channel_key
  on public.subscriptions (subscriber_id, channel_id)
  where channel_id is not null;

create unique index subscriptions_chat_key
  on public.subscriptions (subscriber_id, chat_id)
  where chat_id is not null;

-- Список подписчиков канала — свежие сверху.
create index subscriptions_channel_created_idx
  on public.subscriptions (channel_id, created_at desc, id desc)
  where channel_id is not null;

-- Рассылка о новом посте и попсе — только читателям.
create index subscriptions_channel_readers_idx
  on public.subscriptions (channel_id)
  where in_chats;

create index subscriptions_chat_id_idx on public.subscriptions (chat_id) where chat_id is not null;

alter table public.subscriptions enable row level security;

create policy "subscribers read their own subscriptions"
  on public.subscriptions for select
  to authenticated
  using (subscriber_id = auth.uid());

-- Пишут только функции ниже: подписаться может не каждый (публикующий в
-- канале — нет), а отметки прочтения ставит время сервера.
revoke insert, update, delete on public.subscriptions from anon, authenticated;

-- =============================================================================
-- Счётчики и последний поп на канале
-- =============================================================================
--
-- Денормализованы, как все счётчики: шапка канала и список чатов не считают
-- агрегат на каждый показ. `last_pop_at` — время свежего живого попа: по нему
-- канал встаёт в «Чатах» и понимает, что свежее — поп без поста.

alter table public.channels
  add column subscribers_count int not null default 0,
  add column readers_count int not null default 0,
  add column last_pop_at timestamptz;

update public.channels ch
set last_pop_at = (
  select max(p.created_at) from public.pops p where p.channel_id = ch.id and p.deleted_at is null
);

create function public.count_subscription()
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
    end if;
  elsif tg_op = 'DELETE' then
    if old.channel_id is not null then
      update public.channels
      set subscribers_count = greatest(subscribers_count - 1, 0),
          readers_count = greatest(readers_count - old.in_chats::int, 0)
      where id = old.channel_id;
    end if;
  elsif new.channel_id is not null and old.in_chats is distinct from new.in_chats then
    update public.channels
    set readers_count = greatest(readers_count + case when new.in_chats then 1 else -1 end, 0)
    where id = new.channel_id;
  end if;

  return null;
end;
$$;

revoke execute on function public.count_subscription() from public, anon, authenticated;

create trigger subscriptions_count
  after insert or delete or update of in_chats on public.subscriptions
  for each row execute function public.count_subscription();

create function public.track_last_pop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then
      update public.channels
      set last_pop_at = greatest(last_pop_at, new.created_at)
      where id = new.channel_id;
    end if;
  elsif new.deleted_at is distinct from old.deleted_at then
    -- Удалён (или возвращён) поп: свежий — заново, по индексу живых попсов канала.
    update public.channels
    set last_pop_at = (
      select max(p.created_at) from public.pops p
      where p.channel_id = new.channel_id and p.deleted_at is null
    )
    where id = new.channel_id;
  end if;

  return null;
end;
$$;

revoke execute on function public.track_last_pop() from public, anon, authenticated;

create trigger pops_track_last
  after insert or update of deleted_at on public.pops
  for each row execute function public.track_last_pop();

-- =============================================================================
-- Непрочитанное подписчика
-- =============================================================================
--
-- Внутренние: принимают зрителя параметром и читают закрытую `pop_views`,
-- поэтому клиенту закрыты. Счёт до 100 — дальше число на вкладке не растёт,
-- а считать тысячи строк ради «99+» незачем.
--
-- Пост с попом, который я уже посмотрел, прочитан: это тот же контент, что
-- на «Попсах», и одного просмотра достаточно, чтобы точка ушла.

create function public.subscription_unread_messages(target_chat uuid, since timestamptz, viewer uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from (
    select 1
    from public.messages m
    where m.chat_id = target_chat
      and m.deleted_at is null
      and m.created_at > since
      and m.author_id is distinct from viewer
      and m.kind <> 'system'
      and not exists (
        select 1
        from public.attachments a
        join public.pop_views v on v.pop_id = a.pop_id and v.viewer_id = viewer
        where a.message_id = m.id
      )
    limit 100
  ) unread
$$;

create function public.subscription_unread_pops(target_channel uuid, since timestamptz, viewer uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from (
    select 1
    from public.pops p
    where p.channel_id = target_channel
      and p.deleted_at is null
      and p.created_at > since
      and p.author_id is distinct from viewer
      and not exists (select 1 from public.pop_views v where v.pop_id = p.id and v.viewer_id = viewer)
    limit 100
  ) unread
$$;

revoke execute on function public.subscription_unread_messages(uuid, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.subscription_unread_pops(uuid, timestamptz, uuid) from public, anon, authenticated;

/**
 * Мои подписки на каналы с непрочитанным. Без аргумента — те, что в «Чатах»
 * (список чатов); с каналом — подписка на него, в чатах она или нет (экран
 * канала, просмотр попсов). Не подписан — пустой ответ.
 */
create function public.my_channel_subscriptions(target_channel uuid default null)
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
    and case when target_channel is null then s.in_chats else s.channel_id = target_channel end
$$;

revoke execute on function public.my_channel_subscriptions(uuid) from public, anon;
grant execute on function public.my_channel_subscriptions(uuid) to authenticated;

-- =============================================================================
-- Подписка: подписаться, в чаты, уведомления, отписаться, прочитать
-- =============================================================================

/**
 * Подписаться на канал; `add_to_chats` — сразу читателем. Повтор — не ошибка:
 * уже подписанный с флагом становится читателем, без флага остаётся как был.
 * Публикующий в канале подписаться не может: он и так участник чата постов.
 */
create function public.subscribe_to_channel(target_channel uuid, add_to_chats boolean default false)
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

  if not exists (select 1 from public.channels where id = target_channel and deleted_at is null) then
    raise exception 'Канал не найден' using errcode = 'P0002';
  end if;

  if public.can_publish_in_channel(target_channel, me) then
    raise exception 'На свой канал не подписываются' using errcode = '42501';
  end if;

  insert into public.subscriptions as s (subscriber_id, channel_id, in_chats)
  values (me, target_channel, coalesce(add_to_chats, false))
  on conflict (subscriber_id, channel_id) where channel_id is not null
  do update set in_chats = s.in_chats or excluded.in_chats;
end;
$$;

revoke execute on function public.subscribe_to_channel(uuid, boolean) from public, anon;
grant execute on function public.subscribe_to_channel(uuid, boolean) to authenticated;

/** Показывать канал в «Чатах» или нет. Подписки нет — P0002. */
create function public.set_channel_in_chats(target_channel uuid, value boolean)
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
  set in_chats = coalesce(value, false)
  where subscriber_id = auth.uid() and channel_id = target_channel;

  if not found then
    raise exception 'Подписки нет' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_channel_in_chats(uuid, boolean) from public, anon;
grant execute on function public.set_channel_in_chats(uuid, boolean) to authenticated;

/** Карточки о новых постах и попсах. Подписки нет — P0002. */
create function public.set_channel_notifications(target_channel uuid, enabled boolean)
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
  where subscriber_id = auth.uid() and channel_id = target_channel;

  if not found then
    raise exception 'Подписки нет' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_channel_notifications(uuid, boolean) from public, anon;
grant execute on function public.set_channel_notifications(uuid, boolean) to authenticated;

/** Отписаться. Подписки и так нет — не ошибка: второе устройство успело раньше. */
create function public.unsubscribe_from_channel(target_channel uuid)
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
  where subscriber_id = auth.uid() and channel_id = target_channel;
end;
$$;

revoke execute on function public.unsubscribe_from_channel(uuid) from public, anon;
grant execute on function public.unsubscribe_from_channel(uuid) to authenticated;

/**
 * Отметка прочтения подписчика — временем сервера: посты, попсы или всё.
 * Не подписан — ничего не происходит: посторонний читает канал без отметок.
 */
create function public.mark_channel_read(
  target_channel uuid,
  read_posts boolean default true,
  read_pops boolean default true
)
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
  set messages_read_at = case when read_posts then now() else messages_read_at end,
      pops_read_at = case when read_pops then now() else pops_read_at end
  where subscriber_id = auth.uid() and channel_id = target_channel;
end;
$$;

revoke execute on function public.mark_channel_read(uuid, boolean, boolean) from public, anon;
grant execute on function public.mark_channel_read(uuid, boolean, boolean) to authenticated;

-- =============================================================================
-- Список подписчиков — только создателю канала
-- =============================================================================

/**
 * Подписчики канала, свежие сверху, страницами по ключу (время, id) последней
 * строки прошлой страницы. Видит только владелец: кто на что подписан —
 * приватное, остальным — только числа на канале.
 */
create function public.list_channel_subscribers(
  target_channel uuid,
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
  in_chats boolean,
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
    select 1 from public.channels ch
    where ch.id = target_channel and ch.owner_id = auth.uid() and ch.deleted_at is null
  ) then
    raise exception 'Подписчиков видит только создатель канала' using errcode = '42501';
  end if;

  return query
  select s.id, s.subscriber_id, p.display_name, p.username, p.avatar_url, s.in_chats, s.created_at
  from public.subscriptions s
  join public.profiles p on p.id = s.subscriber_id and p.deleted_at is null
  where s.channel_id = target_channel
    and (before_created is null or (s.created_at, s.id) < (before_created, before_id))
  order by s.created_at desc, s.id desc
  limit least(greatest(coalesce(page_size, 30), 1), 100);
end;
$$;

revoke execute on function public.list_channel_subscribers(uuid, timestamptz, uuid, int) from public, anon;
grant execute on function public.list_channel_subscribers(uuid, timestamptz, uuid, int) to authenticated;

-- =============================================================================
-- События читателям: новый пост
-- =============================================================================
--
-- Та же функция, что в 20261001100000_calls.sql, плюс читатели канала: им,
-- как участникам, `new_message` в `user:<id>` — чтобы канал поднялся в
-- «Чатах» и пришла карточка. Флаг `notify` едет в событии: список
-- обновляется всегда, карточку клиент показывает только при `notify`.
--
-- Рассылка — циклом по читателям внутри триггера, то есть время вставки поста
-- растёт с их числом. На нынешних объёмах (единицы и десятки читателей) это
-- незаметно; когда читателей станут тысячи, рассылка переезжает в очередь
-- (pg_net / Edge Function пачками) или в общий топик канала, на который
-- клиент читателя подписывается сам.

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

-- =============================================================================
-- События читателям: новый поп
-- =============================================================================
--
-- Отложенный до конца транзакции: `publish_pop` вставляет пост с попом после
-- самого попа, и только к фиксации видно, есть ли он. Есть — о нём уже
-- сообщил пост, вторая карточка о том же контенте лишняя. Рассылка — тем же
-- циклом по читателям, с тем же долгом (см. выше).

create function public.broadcast_new_pop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ch public.channels;
  reader record;
  payload jsonb;
begin
  if new.deleted_at is not null or exists (select 1 from public.attachments where pop_id = new.id) then
    return null;
  end if;

  select * into ch from public.channels where id = new.channel_id;

  payload := jsonb_build_object(
    'pop_id', new.id,
    'channel_id', ch.id,
    'chat_id', ch.posts_chat_id,
    'channel_title', ch.title,
    'channel_avatar_url', ch.avatar_url,
    'created_at', new.created_at
  );

  begin
    for reader in
      select subscriber_id, notify from public.subscriptions
      where channel_id = new.channel_id and in_chats
    loop
      perform realtime.send(
        payload || jsonb_build_object('notify', reader.notify),
        'new_pop',
        'user:' || reader.subscriber_id::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;

  return null;
end;
$$;

revoke execute on function public.broadcast_new_pop() from public, anon, authenticated;

create constraint trigger pops_broadcast_new
  after insert on public.pops
  deferrable initially deferred
  for each row execute function public.broadcast_new_pop();
