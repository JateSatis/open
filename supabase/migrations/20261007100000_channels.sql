-- Каналы, этап 1: канал, его чат постов и общее пространство имён.
--
-- Канал — самостоятельная сущность: название, описание, username, аватарка,
-- владелец. Раздел «Посты» — это обычный чат вида `channel_posts`, связанный с
-- каналом один к одному; посты — обычные сообщения в нём, поэтому реакции,
-- комментарии, просмотры, пересылка и закреп работают как у сообщений.
--
-- Правило, ради которого написана половина миграции: участниками чата постов
-- становятся только те, кому канал разрешил публиковать (сейчас владелец,
-- позже модераторы), и только через функции канала. Подписчики и читатели
-- участниками не становятся никогда — иначе центральная политика на
-- `messages` пустила бы их писать посты. Поэтому все остальные пути в
-- `chat_members`, `chat_invites` и звонки отказывают чату постов явно, по его
-- виду, а не потому что «так совпало».

-- =============================================================================
-- Вид чата `channel_posts`
-- =============================================================================

alter table public.chats drop constraint chats_kind_check;
alter table public.chats
  add constraint chats_kind_check check (kind in ('direct', 'group', 'channel_posts'));

-- Имя чата постов — название канала. Своё название у чата разошлось бы с
-- каналом при первой же правке, поэтому его нет совсем (а создатель, которому
-- открыт UPDATE title, получает отказ).
alter table public.chats
  add constraint chats_channel_posts_untitled check (kind <> 'channel_posts' or title is null);

-- Цель составного ключа из `channels`: канал ссылается только на чат постов.
alter table public.chats add constraint chats_id_kind_key unique (id, kind);

-- =============================================================================
-- channels
-- =============================================================================
--
-- `owner_id` — `on delete set null` по общему правилу: удаление аккаунта не
-- рушит канал и его посты. Права на канал — свойство канала; когда появятся
-- модераторы, они лягут отдельной таблицей канала, а не в `chat_members`.

create table public.channels (
  id uuid primary key default gen_random_uuid (),
  title text not null,
  description text,
  username text not null,
  avatar_url text,
  owner_id uuid references public.profiles (id) on delete set null,
  posts_chat_id uuid not null,
  posts_chat_kind text not null default 'channel_posts',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint channels_title_not_blank check (btrim(title) <> ''),
  constraint channels_posts_chat_kind check (posts_chat_kind = 'channel_posts'),
  -- Один чат постов — один канал. Пара, а не одна колонка: так PostgREST видит
  -- связь один к одному и отдаёт канал чата объектом.
  constraint channels_posts_chat_key unique (posts_chat_id, posts_chat_kind),
  foreign key (posts_chat_id, posts_chat_kind) references public.chats (id, kind)
);

create index channels_owner_id_idx on public.channels (owner_id);

alter table public.channels enable row level security;

create policy "channels are readable by authenticated users"
  on public.channels for select
  to authenticated
  using (deleted_at is null);

-- Политик на запись нет: канал создают и меняют только функции.
revoke insert, update, delete on public.channels from anon, authenticated;

/** Чат постов без канала — сирота, которого нельзя ни назвать, ни открыть. */
create function public.enforce_channel_posts_chat()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.channels where posts_chat_id = new.id) then
    raise exception 'Чат постов существует только у канала' using errcode = '23514';
  end if;

  return null;
end;
$$;

-- Отложенная: канал ссылается на чат, значит чат вставляется первым, а канал —
-- следом в той же транзакции.
create constraint trigger chats_channel_posts_have_channel
  after insert on public.chats
  deferrable initially deferred
  for each row
  when (new.kind = 'channel_posts')
  execute function public.enforce_channel_posts_chat();

-- =============================================================================
-- handles: общее пространство имён профилей и каналов
-- =============================================================================
--
-- `@имя` ведёт ровно на одно: профиль или канал. Реестр — единственное место,
-- где уникальность проверяется, без учёта регистра. Колонки `username` в
-- `profiles` и `channels` остаются источником для чтения, а реестр держат в
-- синхроне триггеры ниже. Конфликт в реестре — обычный 23505, поэтому прямой
-- UPDATE профиля по-прежнему отказывает тем же кодом.
--
-- Ключи на владельца — `on delete cascade`: имя не публичная история, а
-- бронь, и вместе с аккаунтом она освобождается.

create table public.handles (
  id uuid primary key default gen_random_uuid (),
  handle text not null,
  profile_id uuid unique references public.profiles (id) on delete cascade,
  channel_id uuid unique references public.channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint handles_single_owner check (num_nonnulls(profile_id, channel_id) = 1)
);

create unique index handles_handle_key on public.handles (lower(handle));

alter table public.handles enable row level security;

create policy "handles are readable by authenticated users"
  on public.handles for select
  to authenticated
  using (true);

revoke insert, update, delete on public.handles from anon, authenticated;

insert into public.handles (handle, profile_id)
select username, id from public.profiles where username is not null;

create function public.sync_profile_handle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.username is null then
    delete from public.handles where profile_id = new.id;
  else
    insert into public.handles (handle, profile_id)
    values (new.username, new.id)
    on conflict (profile_id) do update
      set handle = excluded.handle
      where handles.handle is distinct from excluded.handle;
  end if;

  return null;
end;
$$;

create trigger profiles_sync_handle
  after insert or update of username on public.profiles
  for each row execute function public.sync_profile_handle();

create function public.sync_channel_handle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.handles (handle, channel_id)
  values (new.username, new.id)
  on conflict (channel_id) do update
    set handle = excluded.handle
    where handles.handle is distinct from excluded.handle;

  return null;
end;
$$;

create trigger channels_sync_handle
  after insert or update of username on public.channels
  for each row execute function public.sync_channel_handle();

revoke execute on function public.sync_profile_handle() from public, anon, authenticated;
revoke execute on function public.sync_channel_handle() from public, anon, authenticated;

/** Свободно ли `@имя` — для проверки на лету в форме. Занятое мной тоже занято. */
create function public.is_handle_available(candidate text)
returns boolean
language sql
stable
set search_path = public
as $$
  select not exists (
    select 1 from public.handles where lower(handle) = lower(btrim(candidate))
  )
$$;

revoke execute on function public.is_handle_available(text) from public, anon;
grant execute on function public.is_handle_available(text) to authenticated;

-- =============================================================================
-- Участники чата постов — только через функции канала
-- =============================================================================
--
-- Функция канала поднимает на время своей транзакции флаг
-- `open.channel_staff`; без него вставка участника в чат постов отказывает,
-- кто бы её ни делал. Флаг ставится только изнутри security definer функций:
-- клиенту запись в `chat_members` закрыта целиком.

create function public.guard_channel_posts_members()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.chats where id = new.chat_id and kind = 'channel_posts')
    and current_setting('open.channel_staff', true) is distinct from 'on' then
    raise exception 'Публиковать в канале назначает только канал' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger chat_members_guard_channel_posts
  before insert on public.chat_members
  for each row execute function public.guard_channel_posts_members();

-- Уйти из чата постов самому нельзя: снимать права — дело канала.
drop policy "chat_members can remove themselves" on public.chat_members;

create policy "chat_members can remove themselves"
  on public.chat_members for delete
  to authenticated
  using (
    auth.uid() = user_id
    and not exists (
      select 1 from public.chats c where c.id = chat_members.chat_id and c.kind = 'channel_posts'
    )
  );

/** В канал не зовут: подписка — отдельная механика канала, не заявка в чат. */
create function public.forbid_channel_posts_invites()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.chats where id = new.chat_id and kind = 'channel_posts') then
    raise exception 'В канал не приглашают' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger chat_invites_forbid_channel_posts
  before insert on public.chat_invites
  for each row execute function public.forbid_channel_posts_invites();

/** Звонок в канале — не звонок: слушать там некого звать. */
create function public.forbid_channel_posts_streams()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.chats where id = new.chat_id and kind = 'channel_posts') then
    raise exception 'В канале нельзя позвонить' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger streams_forbid_channel_posts
  before insert on public.streams
  for each row execute function public.forbid_channel_posts_streams();

-- =============================================================================
-- Создание канала
-- =============================================================================
--
-- Одна транзакция: чат постов, канал, бронь имени (триггером) и владелец —
-- единственный участник чата постов. Занятое имя — OPN02, чтобы клиент
-- отличил его от прочих сбоев без разбора текста.

create function public.create_channel(
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

  insert into public.chats (kind, created_by)
  values ('channel_posts', me)
  returning id into new_chat;

  begin
    insert into public.channels (title, description, username, avatar_url, owner_id, posts_chat_id)
    values (
      clean_title,
      nullif(btrim(channel_description), ''),
      clean_username,
      nullif(btrim(channel_avatar_url), ''),
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

revoke execute on function public.create_channel(text, text, text, text) from public, anon;
grant execute on function public.create_channel(text, text, text, text) to authenticated;

-- =============================================================================
-- Имя чата постов — название канала
-- =============================================================================
--
-- Та же функция, что в 20261002100000_forward_islands.sql, с каналом первым:
-- его название видно в заголовке островка с пересланным постом.

create or replace function public.chat_display_name(public.chats)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select ch.title from public.channels ch where ch.posts_chat_id = $1.id),
    nullif(btrim($1.title), ''),
    (
      select string_agg(coalesce(p.display_name, 'Без имени'), case when $1.kind = 'direct' then ' и ' else ', ' end order by m.joined_at)
      from (
        select cm.user_id, cm.joined_at
        from public.chat_members cm
        where cm.chat_id = $1.id and cm.user_id is distinct from auth.uid()
        order by cm.joined_at
        limit 3
      ) m
      join public.profiles p on p.id = m.user_id
    ),
    case when $1.kind = 'group' then 'Групповой чат' else 'Диалог' end
  )
$$;
