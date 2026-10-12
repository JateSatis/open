-- Раздельные пространства `@имён`: у человека, канала и группы — своё.
--
-- Один и тот же `max` может быть одновременно у человека (`@max`), у канала
-- (`@max.ch`) и у группы (`@max.di`): суффикс — это вид сущности, он не
-- хранится и не вводится. Поэтому общий реестр `handles`, сравнивавший
-- профили и каналы между собой, уходит целиком, а уникальность живёт в
-- каждой таблице отдельно — частичным индексом по `lower(username)`.
--
-- Алфавит — инвариант (латиница, цифры, `_`; точки нет нигде): точка
-- сделала бы `@max.ch` неоднозначным, а пробел или кириллица в имени ломают
-- упоминания и позволяют выдать себя за другого. Длина и нижний регистр —
-- продуктовые правила клиента (src/features/profile/username.ts).

-- =============================================================================
-- Реестр handles — больше не нужен
-- =============================================================================

drop trigger profiles_sync_handle on public.profiles;
drop trigger channels_sync_handle on public.channels;
drop function public.sync_profile_handle();
drop function public.sync_channel_handle();
drop function public.is_handle_available(text);
drop table public.handles;

-- =============================================================================
-- profiles: уникальность без учёта регистра, алфавит в схеме
-- =============================================================================

drop index public.profiles_username_key;
create unique index profiles_username_key
  on public.profiles (lower(username)) where username is not null;

alter table public.profiles
  add constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]+$');

-- =============================================================================
-- channels: имя обязательно (not null уже есть), уникально среди каналов
-- =============================================================================

create unique index channels_username_key on public.channels (lower(username));

alter table public.channels
  add constraint channels_username_format check (username ~ '^[A-Za-z0-9_]+$');

-- =============================================================================
-- chats.username: только у групп
-- =============================================================================
--
-- Прямой UPDATE колонки закрыт сам: у `authenticated` на `chats` право
-- обновления выдано только на колонку `title` (20260926120000_chat_invites.sql),
-- новая колонка в него не входит. Пишет только `set_chat_username`.

alter table public.chats add column username text;

alter table public.chats
  add constraint chats_username_format check (username ~ '^[A-Za-z0-9_]+$'),
  add constraint chats_username_group_only check (username is null or kind = 'group');

create unique index chats_username_key
  on public.chats (lower(username)) where username is not null;

/**
 * Задать, сменить или убрать (`null` / пустая строка) `@имя` группы. Может
 * любой участник живой группы; у личного диалога и чата постов имени нет.
 */
create function public.set_chat_username(target_chat uuid, new_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := nullif(btrim(new_username), '');
  target_kind text;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select kind into target_kind
  from public.chats
  where id = target_chat and deleted_at is null
  for update;

  if target_kind is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if target_kind <> 'group' then
    raise exception 'Имя бывает только у группы' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.chat_members where chat_id = target_chat and user_id = me
  ) then
    raise exception 'Менять имя группы может только участник' using errcode = '42501';
  end if;

  if clean is not null and clean !~ '^[A-Za-z0-9_]+$' then
    raise exception 'Имя может состоять только из латиницы, цифр и _' using errcode = '22023';
  end if;

  begin
    update public.chats set username = clean where id = target_chat;
  exception
    when unique_violation then
      raise exception 'Это имя уже занято' using errcode = 'OPN02';
  end;

  return clean;
end;
$$;

revoke execute on function public.set_chat_username(uuid, text) from public, anon;
grant execute on function public.set_chat_username(uuid, text) to authenticated;

-- =============================================================================
-- Проверка свободного имени — в пространстве своей сущности
-- =============================================================================

/**
 * Свободно ли `@имя` среди сущностей вида `target_kind` (profile | channel |
 * group). Своё текущее имя там, где его редактируют, занятым не считается:
 * у профиля — всегда моё, у группы и канала — сущность `own_id`.
 */
create function public.is_username_available(
  target_kind text,
  candidate text,
  own_id uuid default null
)
returns boolean
language plpgsql
stable
-- Definer: удалённые чаты и профили скрыты RLS, но имя держат — ответ
-- «свободно» разошёлся бы с уникальным индексом.
security definer
set search_path = public
as $$
declare
  clean text := lower(btrim(candidate));
begin
  if target_kind = 'profile' then
    return not exists (
      select 1 from public.profiles
      where lower(username) = clean and id is distinct from auth.uid()
    );
  elsif target_kind = 'channel' then
    return not exists (
      select 1 from public.channels
      where lower(username) = clean and id is distinct from own_id
    );
  elsif target_kind = 'group' then
    return not exists (
      select 1 from public.chats
      where lower(username) = clean and id is distinct from own_id
    );
  end if;

  raise exception 'Неизвестный вид сущности: %', target_kind using errcode = '22023';
end;
$$;

revoke execute on function public.is_username_available(text, text, uuid) from public, anon;
grant execute on function public.is_username_available(text, text, uuid) to authenticated;
