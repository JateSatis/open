-- Страница информации о канале и правка канала.
--
-- Канал меняют только функции, как и создают: прямой записи в `channels` у
-- клиента нет (20261007100000_channels.sql). Право — одно место,
-- `can_manage_channel`: сейчас владелец, позже туда лягут модераторы.
--
-- Сигнал об изменении — `chat_changed` через `notify_chat_changed` чата
-- постов: в топик `chat:<posts_chat_id>` (его слушают «Посты» и страница
-- канала, у всех, кто их открыл, и у постороннего) и лично — участникам чата
-- постов и читателям канала, у которых он лежит в «Чатах».
--
-- Ещё здесь: поиск подписчиков для владельца, сводка страницы канала и
-- поиск канала по `@имени` для ссылки `openger://c/<имя>`.

-- =============================================================================
-- Право управлять каналом
-- =============================================================================

/**
 * Может ли `who` менять канал: название, описание, `@имя`, фото, видеть
 * подписчиков. Сейчас — только владелец живого канала. Единственное место
 * этого правила.
 */
create function public.can_manage_channel(target_channel uuid, who uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.channels ch
    where ch.id = target_channel
      and ch.deleted_at is null
      and ch.owner_id = who
  );
$$;

revoke execute on function public.can_manage_channel(uuid, uuid) from public, anon;
grant execute on function public.can_manage_channel(uuid, uuid) to authenticated;

-- =============================================================================
-- Описание и фото: границы схемы
-- =============================================================================

-- Граница — против мусора, а не продуктовый лимит: тот живёт на клиенте.
alter table public.channels
  add constraint channels_description_length check (char_length(description) <= 4000);

-- Один файл — фото одного канала: заменённый файл клиент удаляет, и это
-- безопасно, только пока файл не стоит у другого канала (как у групп,
-- 20261018130000_group_avatar_one_file_one_group.sql).
create unique index channels_avatar_url_key
  on public.channels (avatar_url) where avatar_url is not null;

/**
 * Пустая строка — null; иначе адрес обязан быть существующим файлом в
 * папке `folder` моего префикса бакета `media` — та же проверка, что
 * `clean_group_avatar_url`, для любой папки аватарок. Начало адреса — из
 * подписанного `iss` токена. Внутренняя.
 */
create function public.clean_own_avatar_url(url text, folder text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := nullif(btrim(url), '');
  issuer text := current_setting('request.jwt.claims', true)::jsonb ->> 'iss';
  prefix text;
  object_path text;
begin
  if clean is null then
    return null;
  end if;

  if me is null or issuer is null or issuer !~ '/auth/v1$' then
    raise exception 'Не удалось проверить адрес фото' using errcode = '42501';
  end if;

  prefix := regexp_replace(issuer, '/auth/v1$', '') || '/storage/v1/object/public/media/';

  if left(clean, length(prefix)) <> prefix then
    raise exception 'Фото должно быть загружено в Open' using errcode = '22023';
  end if;

  object_path := substr(clean, length(prefix) + 1);

  if object_path !~ ('^' || me::text || '/' || folder || '/[A-Za-z0-9_-]+\.jpg$') then
    raise exception 'Фото должно быть загружено в Open' using errcode = '22023';
  end if;

  if not exists (
    select 1 from storage.objects where bucket_id = 'media' and name = object_path
  ) then
    raise exception 'Файл фото не найден' using errcode = '22023';
  end if;

  return clean;
end;
$$;

revoke execute on function public.clean_own_avatar_url(text, text) from public, anon, authenticated;

-- =============================================================================
-- create_channel: фото — только свой файл
-- =============================================================================
--
-- Та же функция, что в 20261007110000_channel_username_format.sql; адрес
-- фото проверяется так же, как при смене: иначе в обход приложения канал
-- создавался бы со сторонней картинкой.

create or replace function public.create_channel(
  channel_title text,
  channel_username text,
  channel_description text default null,
  channel_avatar_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean_title text := nullif(btrim(channel_title), '');
  clean_username text := nullif(btrim(channel_username), '');
  new_chat uuid;
  new_channel uuid;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles where id = me and deleted_at is null) then
    raise exception 'Профиль удалён' using errcode = '42501';
  end if;

  if clean_title is null then
    raise exception 'Укажите название канала' using errcode = '22023';
  end if;

  if clean_username is null then
    raise exception 'Укажите имя канала' using errcode = '22023';
  end if;

  if clean_username !~ '^[A-Za-z0-9_]{1,64}$' then
    raise exception 'Имя может состоять только из латиницы, цифр и _' using errcode = '22023';
  end if;

  insert into public.chats (kind, created_by)
  values ('channel_posts', me)
  returning id into new_chat;

  begin
    insert into public.channels (title, description, username, avatar_url, owner_id, posts_chat_id)
    values (
      clean_title,
      nullif(btrim(channel_description), ''),
      clean_username,
      public.clean_own_avatar_url(channel_avatar_url, 'channel-avatar'),
      me,
      new_chat
    )
    returning id into new_channel;
  exception
    when unique_violation then
      raise exception 'Это имя уже занято' using errcode = 'OPN02';
  end;

  perform set_config('open.channel_staff', 'on', true);
  insert into public.chat_members (chat_id, user_id) values (new_chat, me);
  perform set_config('open.channel_staff', '', true);

  return jsonb_build_object('channel_id', new_channel, 'chat_id', new_chat);
end;
$$;

-- =============================================================================
-- Правка канала
-- =============================================================================

/**
 * Канал изменился: `chat_changed` по чату постов — в его топик и лично
 * участникам чата постов (публикующим) и читателям, у которых канал в
 * «Чатах»: строка в списке и шапка канала перечитываются. Рассылка читателям
 * — циклом, как у нового поста (20261013100000_channel_subscriptions.sql).
 */
create function public.notify_channel_changed(target_channel uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  posts_chat uuid;
  readers uuid[];
begin
  select posts_chat_id into posts_chat from public.channels where id = target_channel;

  if posts_chat is null then
    return;
  end if;

  select coalesce(array_agg(subscriber_id), '{}') into readers
  from public.subscriptions
  where channel_id = target_channel and in_chats;

  perform public.notify_chat_changed(posts_chat, readers);
end;
$$;

revoke execute on function public.notify_channel_changed(uuid) from public, anon, authenticated;

/**
 * Живой канал под замком для правки, иначе отказ. Внутренняя: общая часть
 * `set_channel_*`.
 */
create function public.lock_managed_channel(target_channel uuid, what text)
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

  perform 1 from public.channels
  where id = target_channel and deleted_at is null
  for update;

  if not found then
    raise exception 'Канал не найден' using errcode = 'P0002';
  end if;

  if not public.can_manage_channel(target_channel, me) then
    raise exception 'Менять % канала может только его владелец', what using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.lock_managed_channel(uuid, text) from public, anon, authenticated;

/** Сменить название канала. Пустое — отказ: без названия канала нет. */
create function public.set_channel_title(target_channel uuid, new_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := nullif(btrim(new_title), '');
begin
  perform public.lock_managed_channel(target_channel, 'название');

  if clean is null then
    raise exception 'Укажите название канала' using errcode = '22023';
  end if;

  update public.channels set title = clean where id = target_channel;

  perform public.notify_channel_changed(target_channel);
end;
$$;

revoke execute on function public.set_channel_title(uuid, text) from public, anon;
grant execute on function public.set_channel_title(uuid, text) to authenticated;

/** Задать или убрать (`null` / пустая строка) описание канала. */
create function public.set_channel_description(target_channel uuid, new_description text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.lock_managed_channel(target_channel, 'описание');

  update public.channels
  set description = nullif(btrim(new_description), '')
  where id = target_channel;

  perform public.notify_channel_changed(target_channel);
end;
$$;

revoke execute on function public.set_channel_description(uuid, text) from public, anon;
grant execute on function public.set_channel_description(uuid, text) to authenticated;

/**
 * Сменить `@имя` канала. Имя у канала обязательно; занятое другим каналом —
 * OPN02, как при создании. Прежнее имя освобождается сразу: ссылки на него
 * больше не ведут на этот канал. Отдаёт новое имя.
 */
create function public.set_channel_username(target_channel uuid, new_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := nullif(btrim(new_username), '');
begin
  perform public.lock_managed_channel(target_channel, 'имя');

  if clean is null then
    raise exception 'Укажите имя канала' using errcode = '22023';
  end if;

  if clean !~ '^[A-Za-z0-9_]{1,64}$' then
    raise exception 'Имя может состоять только из латиницы, цифр и _' using errcode = '22023';
  end if;

  begin
    update public.channels set username = clean where id = target_channel;
  exception
    when unique_violation then
      raise exception 'Это имя уже занято' using errcode = 'OPN02';
  end;

  perform public.notify_channel_changed(target_channel);

  return clean;
end;
$$;

revoke execute on function public.set_channel_username(uuid, text) from public, anon;
grant execute on function public.set_channel_username(uuid, text) to authenticated;

/**
 * Поставить, сменить или убрать (`null` / пустая строка) фото канала. Адрес
 * — только свой файл в `channel-avatar/`. Отдаёт прежний адрес — тот, что
 * заменён на самом деле: его файл клиент удаляет, если файл его.
 */
create function public.set_channel_avatar(target_channel uuid, new_avatar_url text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  previous text;
begin
  perform public.lock_managed_channel(target_channel, 'фото');

  select avatar_url into previous from public.channels where id = target_channel;

  update public.channels
  set avatar_url = public.clean_own_avatar_url(new_avatar_url, 'channel-avatar')
  where id = target_channel;

  perform public.notify_channel_changed(target_channel);

  return previous;
end;
$$;

revoke execute on function public.set_channel_avatar(uuid, text) from public, anon;
grant execute on function public.set_channel_avatar(uuid, text) to authenticated;

-- =============================================================================
-- Подписчики: поиск по имени для владельца
-- =============================================================================
--
-- Сигнатура меняется — функция пересоздаётся. Право — `can_manage_channel`.

drop function public.list_channel_subscribers(uuid, timestamptz, uuid, int);

/**
 * Подписчики канала, свежие сверху, страницами по ключу (время, id) последней
 * строки прошлой страницы; `query` — по имени или `@имени`. Видит только тот,
 * кто управляет каналом: кто на что подписан — приватное.
 */
create function public.list_channel_subscribers(
  target_channel uuid,
  before_created timestamptz default null,
  before_id uuid default null,
  page_size int default 30,
  query text default null
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
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  needle text := public.search_norm(coalesce(query, ''));
  pattern text;
  user_pattern text;
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not public.can_manage_channel(target_channel, auth.uid()) then
    raise exception 'Подписчиков видит только владелец канала' using errcode = '42501';
  end if;

  pattern := case when needle <> '' then public.search_like(needle) end;
  user_pattern := case
    when needle <> '' then public.search_like(lower(ltrim(btrim(query), '@')))
  end;

  return query
  select s.id, s.subscriber_id, p.display_name, p.username, p.avatar_url, s.in_chats, s.created_at
  from public.subscriptions s
  join public.profiles p on p.id = s.subscriber_id and p.deleted_at is null
  where s.channel_id = target_channel
    and (
      pattern is null
      or public.search_norm(p.display_name) like pattern
      or lower(p.username) like user_pattern
    )
    and (before_created is null or (s.created_at, s.id) < (before_created, before_id))
  order by s.created_at desc, s.id desc
  limit least(greatest(coalesce(page_size, 30), 1), 100);
end;
$$;

revoke execute on function public.list_channel_subscribers(uuid, timestamptz, uuid, int, text) from public, anon;
grant execute on function public.list_channel_subscribers(uuid, timestamptz, uuid, int, text) to authenticated;

-- =============================================================================
-- Сводка страницы канала
-- =============================================================================

/**
 * Счётчики вкладок страницы канала: подписчики и читатели — из счётчиков
 * канала, попсы — живые попсы канала, медиа и голосовые — постов (та же
 * выборка, что у страницы чата). Канала нет — пустой ответ.
 */
create function public.channel_info_summary(target_channel uuid)
returns table (
  subscribers int,
  readers int,
  pops int,
  photos int,
  videos int,
  voices int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    ch.subscribers_count,
    ch.readers_count,
    (select count(*)::int from public.pops p
     where p.channel_id = ch.id and p.deleted_at is null),
    coalesce(s.photos, 0),
    coalesce(s.videos, 0),
    coalesce(s.voices, 0)
  from public.channels ch
  left join lateral public.chat_info_summary(ch.posts_chat_id) s on true
  where ch.id = target_channel and ch.deleted_at is null;
$$;

revoke execute on function public.channel_info_summary(uuid) from public, anon;
grant execute on function public.channel_info_summary(uuid) to authenticated;

-- =============================================================================
-- Канал по `@имени` — для ссылки openger://c/<имя>
-- =============================================================================

/** Живой канал с этим `@именем`, без учёта регистра; нет такого — null. */
create function public.find_channel_by_username(name text)
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select id from public.channels
  where lower(username) = lower(btrim(ltrim(btrim(name), '@')))
    and deleted_at is null
  limit 1;
$$;

revoke execute on function public.find_channel_by_username(text) from public, anon;
grant execute on function public.find_channel_by_username(text) to authenticated;
