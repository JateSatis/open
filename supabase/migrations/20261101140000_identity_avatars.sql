-- Приватность, этап 4: фото людей — в закрытом бакете.
--
-- Раньше аватар лежал в публичном бакете `media` (`{id}/avatar/…`): по
-- публичной ссылке его скачивал кто угодно, а SELECT-политика давала листать
-- чужие префиксы. Теперь:
--   * аватары людей — в бакете `avatars` (не публичном), путь `{id}/{файл}.jpg`;
--   * в `profiles.avatar_url` — путь в этом бакете, а не URL. Клиент получает
--     короткоживущую подписанную ссылку, а Storage выдаёт её только тому, кому
--     фото видно по `avatar_visibility` владельца, и только на текущий аватар;
--   * внешний адрес (фото от Google из `handle_new_user`) остаётся как есть и
--     отдаётся только тем, кому фото видно (`person_card`): уже выданные
--     ссылки на чужие сервера не отозвать.
-- Аватары групп и каналов — не человек: остаются в `media`.
--
-- Файлы `media/{id}/avatar/*` переносит разовый скрипт
-- (`scripts/migrate-avatars.mjs`): Storage двигает файлы только своим API,
-- SQL здесь лишь переписывает ссылки на пути.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

/**
 * Можно ли смотрящему читать файл аватара: это текущий аватар владельца
 * префикса и владелец открыл фото смотрящему. Прежние файлы не читает никто,
 * кроме самого владельца (политика ниже).
 */
create function public.avatar_object_readable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  owner uuid := public.uuid_or_null((storage.foldername(p_name))[1]);
  visibility text;
begin
  if owner is null or auth.uid() is null then
    return false;
  end if;

  if not exists (
    select 1 from public.profiles
    where id = owner and deleted_at is null and avatar_url = p_name
  ) then
    return false;
  end if;

  select s.avatar_visibility into visibility from public.privacy_settings s where s.user_id = owner;

  return public.identity_allows(visibility, owner, auth.uid());
end;
$$;

revoke execute on function public.avatar_object_readable(text) from public, anon;
grant execute on function public.avatar_object_readable(text) to authenticated;

-- Владелец читает свою папку целиком: Storage удаляет только то, что можно
-- прочитать, а прежний файл после смены фото уже не текущий.
create policy "avatars are readable by whom their owner shows them"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.avatar_object_readable(name)
    )
  );

create policy "avatars can only be uploaded into the owner's prefix"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars can only be removed by their owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Старая папка аватаров в `media` больше не читается и не листается.
drop policy "media is readable by authenticated users" on storage.objects;

create policy "media is readable by authenticated users"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[2] is distinct from 'avatar'
  );

/**
 * Свой аватар — только файл своего префикса в `avatars` или ничего. Чужой
 * путь показал бы чужое фото под своим именем, внешний адрес — следил бы за
 * смотрящими. Адрес, который уже стоит (фото от Google), можно оставить.
 */
create function public.guard_profile_avatar()
returns trigger
language plpgsql
as $$
begin
  if new.avatar_url is not distinct from old.avatar_url or new.avatar_url is null then
    return new;
  end if;

  if new.avatar_url !~ ('^' || new.id::text || '/[A-Za-z0-9._-]+\.jpg$') then
    raise exception 'Фото профиля — только свой файл' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_profile_avatar() from public, anon, authenticated;

create trigger profiles_guard_avatar
  before update of avatar_url on public.profiles
  for each row execute function public.guard_profile_avatar();

-- Ссылки на файлы в `media` — пути в `avatars` (сами файлы переносит скрипт).
alter table public.profiles disable trigger profiles_guard_avatar;

update public.profiles
set avatar_url = id::text || '/' || substring(avatar_url from '/avatar/([^/?]+)$')
where avatar_url ~ ('/storage/v1/object/public/media/' || id::text || '/avatar/[^/?]+$');

alter table public.profiles enable trigger profiles_guard_avatar;
