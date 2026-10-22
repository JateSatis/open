-- Приватность, этап 5: метаданные файлов.
--
-- Правило, не настройка: ни один файл, который Open отдаёт другим людям, не
-- несёт метаданных (GPS, модель телефона, даты съёмки, XMP, IPTC, атомы
-- udta/meta контейнера). Чистит Edge Function `sanitize-media`:
--   * клиент кладёт файл во временный закрытый бакет `uploads` (свою папку);
--   * функция чистит его и кладёт на постоянный путь — `chat-media` (медиа
--     сообщений и комментариев, закрытый, доступ — следующая миграция),
--     `avatars` (фото человека) или `media` (попсы, фото групп и каналов);
--   * отмечает чистый файл в реестре `media_objects`.
-- Клиент в постоянные бакеты больше не пишет вовсе. Отправка сообщения,
-- комментария, попа и смена фото принимают только отмеченные файлы своего
-- владельца (OPN14) — старое или изменённое приложение мимо очистки ничего
-- не опубликует.
--
-- Исходные метаданные нигде не сохраняются: реестр знает путь, владельца,
-- вид, тип и размер чистого файла — и всё.

-- =============================================================================
-- Бакеты
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false), ('chat-media', 'chat-media', false)
on conflict (id) do nothing;

-- Временный: пишет и читает только сам, функция забирает файл сервисной ролью
-- и удаляет его после очистки.
create policy "uploads are written into the owner's prefix"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "uploads are readable by their owner"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "uploads are removable by their owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Постоянные бакеты клиент не пишет: только очищенное функцией.
drop policy "media can only be uploaded into the owner's prefix" on storage.objects;
drop policy "avatars can only be uploaded into the owner's prefix" on storage.objects;

-- `media` публичный — файлы отдаёт публичная ссылка без политики. Политика
-- SELECT нужна лишь для листинга и удаления: только свой префикс, чужие
-- папки не листаются.
drop policy "media is readable by authenticated users" on storage.objects;

create policy "media is listed only by its owner"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Удаляет своё (несостоявшаяся отправка). Читать — по политике следующей
-- миграции: Storage удаляет только то, что смотрящий может прочитать.
create policy "chat media can only be removed by its owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =============================================================================
-- Реестр очищенных файлов
-- =============================================================================

create table public.media_objects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bucket text not null check (bucket in ('chat-media', 'media', 'avatars')),
  path text not null,
  -- Аккаунт ушёл — его файлы больше никто не прикрепит.
  owner_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'photo', 'poster', 'video', 'video_note', 'voice',
    'avatar', 'group_avatar', 'channel_avatar', 'pop_video', 'pop_poster'
  )),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sanitized_at timestamptz not null default now(),
  unique (bucket, path)
);

create index media_objects_owner_id_idx on public.media_objects (owner_id);

-- Закрыта целиком: пишет функция `sanitize-media` сервисной ролью, читают
-- проверки ниже с правами владельца.
alter table public.media_objects enable row level security;
revoke all on public.media_objects from anon, authenticated;

/** Файл очищен и принадлежит `p_owner`, вид — один из `p_kinds`. */
create function public.media_object_owned(
  p_bucket text,
  p_path text,
  p_owner uuid,
  p_kinds text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_owner is not null and p_path is not null and exists (
    select 1 from public.media_objects o
    where o.bucket = p_bucket
      and o.path = p_path
      and o.owner_id = p_owner
      and o.kind = any (p_kinds)
  )
$$;

/**
 * Путь в публичном `media` по его публичной ссылке. Начало ссылки — из iss
 * токена смотрящего, как у фото групп: чужой сервер с таким же хвостом не
 * пройдёт. Без токена (сервисная роль) сверяется только хвост.
 */
create function public.public_media_path(p_url text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  issuer text := current_setting('request.jwt.claims', true)::jsonb ->> 'iss';
  marker constant text := '/storage/v1/object/public/media/';
  at int := strpos(coalesce(p_url, ''), marker);
begin
  if at = 0 then
    return null;
  end if;

  if issuer ~ '/auth/v1$'
    and left(p_url, at - 1) <> regexp_replace(issuer, '/auth/v1$', '')
  then
    return null;
  end if;

  return substr(p_url, at + length(marker));
end;
$$;

-- =============================================================================
-- Проверки
-- =============================================================================

/**
 * Вложение сообщения или комментария — только очищенный файл `chat-media`,
 * принадлежащий автору, того вида, что объявлен типом. Вложение-ссылка на
 * поп файла не имеет. Правка (`edit_message` переписывает вложения заново)
 * проходит, потому что оставленные файлы уже в реестре.
 */
create function public.guard_attachment_object()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author uuid;
  kinds text[];
begin
  if tg_table_name = 'attachments' then
    if new.pop_id is not null then
      return new;
    end if;

    select m.author_id into author from public.messages m where m.id = new.message_id;
  else
    select c.author_id into author from public.comments c where c.id = new.comment_id;
  end if;

  if tg_op = 'UPDATE'
    and new.url is not distinct from old.url
    and new.poster_url is not distinct from old.poster_url
  then
    return new;
  end if;

  kinds := case
    when new.mime_type like 'image/%' then array['photo']
    when new.mime_type like 'video/%' then array['video', 'video_note']
    when new.mime_type like 'audio/%' then array['voice']
    else array[]::text[]
  end;

  if not public.media_object_owned('chat-media', new.url, author, kinds)
    or (
      new.poster_url is not null
      and not public.media_object_owned('chat-media', new.poster_url, author, array['poster'])
    )
  then
    raise exception 'Файл не прошёл проверку перед публикацией'
      using errcode = 'OPN14';
  end if;

  return new;
end;
$$;

create trigger attachments_guard_object
  before insert or update of url, poster_url on public.attachments
  for each row execute function public.guard_attachment_object();

create trigger comment_attachments_guard_object
  before insert or update of url, poster_url on public.comment_attachments
  for each row execute function public.guard_attachment_object();

/** Видео и постер попа — очищенные файлы автора попа в публичном `media`. */
create function public.guard_pop_object()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and new.url is not distinct from old.url
    and new.poster_url is not distinct from old.poster_url
  then
    return new;
  end if;

  if not public.media_object_owned(
      'media', public.public_media_path(new.url), new.author_id, array['pop_video']
    )
    or (
      new.poster_url is not null
      and not public.media_object_owned(
        'media', public.public_media_path(new.poster_url), new.author_id, array['pop_poster']
      )
    )
  then
    raise exception 'Файл не прошёл проверку перед публикацией'
      using errcode = 'OPN14';
  end if;

  return new;
end;
$$;

create trigger pops_guard_object
  before insert or update of url, poster_url on public.pops
  for each row execute function public.guard_pop_object();

-- Фото профиля — очищенный файл самого человека в `avatars`. Права владельца:
-- реестр закрыт от клиента.
create or replace function public.guard_profile_avatar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.avatar_url is not distinct from old.avatar_url or new.avatar_url is null then
    return new;
  end if;

  if new.avatar_url !~ ('^' || new.id::text || '/[A-Za-z0-9._-]+\.jpg$') then
    raise exception 'Фото профиля — только свой файл' using errcode = '22023';
  end if;

  if not public.media_object_owned('avatars', new.avatar_url, new.id, array['avatar']) then
    raise exception 'Файл не прошёл проверку перед публикацией' using errcode = 'OPN14';
  end if;

  return new;
end;
$$;

-- Фото группы и канала — очищенный файл того, кто его ставит.
create or replace function public.clean_own_avatar_url(url text, folder text)
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

  if not public.media_object_owned(
    'media', object_path, me,
    array[case folder when 'group-avatar' then 'group_avatar' else 'channel_avatar' end]
  ) then
    raise exception 'Файл не прошёл проверку перед публикацией' using errcode = 'OPN14';
  end if;

  return clean;
end;
$$;

revoke execute on function public.media_object_owned(text, text, uuid, text[]) from public, anon, authenticated;
revoke execute on function public.public_media_path(text) from public, anon, authenticated;
revoke execute on function public.guard_attachment_object() from public, anon, authenticated;
revoke execute on function public.guard_pop_object() from public, anon, authenticated;
