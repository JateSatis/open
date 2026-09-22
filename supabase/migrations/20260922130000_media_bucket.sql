-- Бакет для фото и видео из чата. Без него `uploadMedia()` (src/features/media/storage.ts)
-- не может работать — что и обнаружилось при живой проверке функционала альбомов:
-- бакет `media`, на который код ссылается с самого начала фичи media
-- (см. MEDIA_BUCKET в src/features/media/constants.ts), никогда не создавался.
--
-- Публичный, потому что контент в Open публичный по умолчанию: `uploadMedia()`
-- отдаёт `getPublicUrl()`, которая отдаёт файл без проверки прав — так и
-- задумано, но работает только если сам бакет публичный.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- Запись — только в свой префикс `{userId}/...`, как строит путь
-- buildObjectPath() в src/features/media/lib/objectPath.ts. Чтение открыто
-- всем аутентифицированным — публичный URL и так отдаёт файл без проверки,
-- политика здесь лишь для согласованности с остальной схемой.
create policy "media is readable by authenticated users"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'media');

create policy "media can only be uploaded into the owner's prefix"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "media can only be removed by its owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
