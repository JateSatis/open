-- Приватность, этап 5: очистка метаданных и «Кто видит мои фото, видео и
-- голосовые».
-- A — медиа «только друзьям», F — друг A, P — участник X не друг A,
-- S — посторонний, B — участник X, медиа «всем», Q — участник W не друг A и
-- не участник X. X — группа A, P, B, E; W — группа E и Q (островок с
-- сообщением A из X); Z — группа B и Q (комментарий A посетителем).
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/privacy_media_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, coalesce(ok, false), detail) $$;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'iss', 'https://media-test.supabase.co/auth/v1'
  )::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

/** Код ошибки выражения или 'ok', если оно прошло. */
create function pg_temp.code_of(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

grant execute on function pg_temp.check(text, boolean, text) to authenticated;
grant execute on function pg_temp.code_of(text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000005a1', 'p5a@test.local', '{"full_name":"Мед Анна"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000005f1', 'p5f@test.local', '{"full_name":"Мед Фёдор"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000005b1', 'p5p@test.local', '{"full_name":"Мед Пётр"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000005c1', 'p5s@test.local', '{"full_name":"Мед Сева"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000005d1', 'p5b@test.local', '{"full_name":"Мед Борис"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000005e1', 'p5e@test.local', '{"full_name":"Мед Эльза"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000005e2', 'p5q@test.local', '{"full_name":"Мед Кира"}', 'authenticated', 'authenticated');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000005a1';
  f uuid := '00000000-0000-4000-8000-0000000005f1';
  p uuid := '00000000-0000-4000-8000-0000000005b1';
  s uuid := '00000000-0000-4000-8000-0000000005c1';
  b uuid := '00000000-0000-4000-8000-0000000005d1';
  e uuid := '00000000-0000-4000-8000-0000000005e1';
  q uuid := '00000000-0000-4000-8000-0000000005e2';
  a_photo text := '00000000-0000-4000-8000-0000000005a1/photo/p1.jpg';
  a_video text := '00000000-0000-4000-8000-0000000005a1/video/v1.mp4';
  a_poster text := '00000000-0000-4000-8000-0000000005a1/poster/v1.jpg';
  a_voice text := '00000000-0000-4000-8000-0000000005a1/voice/s1.m4a';
  a_comment_photo text := '00000000-0000-4000-8000-0000000005a1/photo/c1.jpg';
  a_unregistered text := '00000000-0000-4000-8000-0000000005a1/photo/dirty.jpg';
  b_photo text := '00000000-0000-4000-8000-0000000005d1/photo/b1.jpg';
  public_prefix text := 'https://media-test.supabase.co/storage/v1/object/public/media/';
  x uuid;
  w uuid;
  z uuid;
  album uuid;
  voice uuid;
  b_msg uuid;
  z_msg uuid;
  com uuid;
  channel uuid;
  posts uuid;
  res jsonb;
  r record;
  n int;
  t text;
  all_paths text[];
begin
  -- ---------------------------------------------------------------- данные
  perform pg_temp.as_owner();

  update public.privacy_settings set dialogue_media_visibility = 'friends' where user_id = a;
  update public.privacy_settings set dialogue_media_visibility = 'everyone' where user_id = b;

  insert into public.friendships (requester_id, addressee_id, status, accepted_at)
  values (a, f, 'accepted', now());

  -- Очищенные файлы — как их отмечает sanitize-media.
  insert into public.media_objects (bucket, path, owner_id, kind, mime_type, size_bytes) values
    ('chat-media', a_photo, a, 'photo', 'image/jpeg', 10),
    ('chat-media', a_video, a, 'video', 'video/mp4', 10),
    ('chat-media', a_poster, a, 'poster', 'image/jpeg', 10),
    ('chat-media', a_voice, a, 'voice', 'audio/mp4', 10),
    ('chat-media', a_comment_photo, a, 'photo', 'image/jpeg', 10),
    ('chat-media', b_photo, b, 'photo', 'image/jpeg', 10);

  insert into storage.objects (bucket_id, name) values
    ('chat-media', a_photo), ('chat-media', a_video), ('chat-media', a_poster),
    ('chat-media', a_voice), ('chat-media', a_comment_photo), ('chat-media', b_photo),
    ('chat-media', a_unregistered);

  insert into public.chats (kind, created_by, owner_id, title, founding_member_ids)
  values ('group', a, a, 'Мед X', array[a, p, b, e]) returning id into x;
  insert into public.chat_members (chat_id, user_id) values (x, a), (x, p), (x, b), (x, e);

  insert into public.chats (kind, created_by, owner_id, title)
  values ('group', e, e, 'Мед W') returning id into w;
  insert into public.chat_members (chat_id, user_id) values (w, e), (w, q);

  insert into public.chats (kind, created_by, owner_id, title)
  values ('group', b, b, 'Мед Z') returning id into z;
  insert into public.chat_members (chat_id, user_id) values (z, b), (z, q);

  -- ------------------------------------------------- К1.4: только очищенное своё
  perform pg_temp.act_as(a);

  perform pg_temp.check('К1.4 неочищенный файл в альбоме — отказ OPN14',
    pg_temp.code_of(format($q$select public.send_media_message(%L, null, %L::jsonb)$q$, x,
      jsonb_build_array(jsonb_build_object('url', a_unregistered, 'mime_type', 'image/jpeg')))) = 'OPN14');
  perform pg_temp.check('К1.4 чужой очищенный файл — отказ OPN14',
    pg_temp.code_of(format($q$select public.send_media_message(%L, null, %L::jsonb)$q$, x,
      jsonb_build_array(jsonb_build_object('url', b_photo, 'mime_type', 'image/jpeg')))) = 'OPN14');
  perform pg_temp.check('К1.4 прежняя публичная ссылка media — отказ OPN14',
    pg_temp.code_of(format($q$select public.send_media_message(%L, null, %L::jsonb)$q$, x,
      jsonb_build_array(jsonb_build_object('url', public_prefix || a_photo, 'mime_type', 'image/jpeg')))) = 'OPN14');
  perform pg_temp.check('К1.4 фото под видом голосового — отказ OPN14',
    pg_temp.code_of(format($q$select public.send_voice_message(%L, %L::jsonb)$q$, x,
      jsonb_build_object('url', a_photo, 'mime_type', 'audio/mp4', 'duration_ms', 1000))) = 'OPN14');
  perform pg_temp.check('К1.4 неочищенный постер — отказ OPN14',
    pg_temp.code_of(format($q$select public.send_media_message(%L, null, %L::jsonb)$q$, x,
      jsonb_build_array(jsonb_build_object('url', a_video, 'poster_url', a_unregistered, 'mime_type', 'video/mp4')))) = 'OPN14');
  perform pg_temp.check('К1.4 неочищенное фото профиля — отказ OPN14',
    pg_temp.code_of($q$update public.profiles set avatar_url = '00000000-0000-4000-8000-0000000005a1/me.jpg' where id = auth.uid()$q$) = 'OPN14');

  -- Альбом (фото + видео с постером) и голосовое A в X.
  album := public.send_media_message(x, 'Подпись видна всем', jsonb_build_array(
    jsonb_build_object('url', a_photo, 'mime_type', 'image/jpeg', 'width', 400, 'height', 300),
    jsonb_build_object('url', a_video, 'poster_url', a_poster, 'mime_type', 'video/mp4',
      'width', 720, 'height', 1280, 'duration_ms', 5000)
  ));
  voice := public.send_voice_message(x, jsonb_build_object(
    'url', a_voice, 'mime_type', 'audio/mp4', 'duration_ms', 3000, 'waveform', jsonb_build_array(1, 5, 9)
  ));

  perform pg_temp.check('К1.6 альбом и голосовое из очищенных файлов отправляются',
    album is not null and voice is not null);

  perform pg_temp.check('К1.4 комментарий с неочищенным фото — отказ OPN14',
    pg_temp.code_of(format($q$select public.send_comment(%L, 'к', %L::jsonb)$q$, album,
      jsonb_build_array(jsonb_build_object('url', a_unregistered, 'mime_type', 'image/jpeg')))) = 'OPN14');

  perform pg_temp.act_as(b);
  b_msg := public.send_media_message(x, null, jsonb_build_array(
    jsonb_build_object('url', b_photo, 'mime_type', 'image/jpeg', 'width', 10, 'height', 10)
  ));
  z_msg := public.send_media_message(z, 'Сообщение Б в Z', '[]'::jsonb);

  -- A комментирует посетителем в Z, с фото.
  perform pg_temp.act_as(a);
  com := public.send_comment(z_msg, 'Фото от A', jsonb_build_array(
    jsonb_build_object('url', a_comment_photo, 'mime_type', 'image/jpeg', 'width', 30, 'height', 20)
  ));

  -- E пересылает альбом A из X в W.
  perform pg_temp.act_as(e);
  perform public.forward_messages(w, x, array[album]);

  -- ------------------------------------------------- К2.1: кто видит
  perform pg_temp.act_as(p);
  select count(*) filter (where url is not null and not media_hidden) into n
  from public.attachment_rows where message_id in (album, voice);
  perform pg_temp.check('К2.1 участник P видит фото, видео и голосовое', n = 3, n::text);
  perform pg_temp.check('К2.1 P открывает файлы',
    public.chat_media_object_readable(a_photo) and public.chat_media_object_readable(a_poster)
      and public.chat_media_object_readable(a_voice));

  perform pg_temp.act_as(f);
  select count(*) filter (where url is not null and not media_hidden) into n
  from public.attachment_rows where message_id in (album, voice);
  perform pg_temp.check('К2.1 друг F видит всё', n = 3, n::text);

  perform pg_temp.act_as(s);
  select count(*) into n from public.attachment_rows
  where message_id in (album, voice) and media_hidden
    and url is null and poster_url is null and waveform is null;
  perform pg_temp.check('К2.1 S — три плитки «скрыто автором» без пути, постера и волны', n = 3, n::text);
  select * into r from public.attachment_rows where message_id = album and mime_type = 'video/mp4';
  perform pg_temp.check('К2.1 у плитки S — вид, пропорции и длительность',
    r.width = 720 and r.height = 1280 and r.duration_ms = 5000);
  select * into r from public.attachment_rows where message_id = voice;
  perform pg_temp.check('К2.1 у голосового S — длительность без волны',
    r.duration_ms = 3000 and r.waveform is null);
  perform pg_temp.check('К2.1 подпись сообщения S видна',
    (select text from public.message_rows where id = album) = 'Подпись видна всем');

  -- ------------------------------------------------- К2.2: файл не выдаётся
  perform pg_temp.check('К2.2 S не открывает ни файл, ни постер, ни голосовое',
    not public.chat_media_object_readable(a_photo) and not public.chat_media_object_readable(a_video)
      and not public.chat_media_object_readable(a_poster) and not public.chat_media_object_readable(a_voice));
  select count(*) into n from storage.objects where bucket_id = 'chat-media';
  perform pg_temp.check('К2.2 S не листает и не читает chat-media (видно только открытое)', n = 1, n::text);
  perform pg_temp.check('К2.2 S не читает attachments и comment_attachments напрямую',
    pg_temp.code_of('select url from public.attachments limit 1') = '42501'
      and pg_temp.code_of('select url from public.comment_attachments limit 1') = '42501');
  select count(*) into n from storage.objects where bucket_id = 'media'
    and (storage.foldername(name))[1] <> s::text;
  perform pg_temp.check('К2.2 S не листает чужие папки media', n = 0, n::text);
  select count(*) filter (where url is null and poster_url is null and media_hidden) into n
  from public.list_chat_media(x) where message_id = album;
  perform pg_temp.check('К2.2 вкладка «Медиа» у S — плитки без путей', n = 2, n::text);
  select count(*) filter (where url is null and waveform is null and media_hidden) into n
  from public.list_chat_voices(x) where message_id = voice;
  perform pg_temp.check('К2.2 вкладка «Голосовые» у S — без пути и волны', n = 1, n::text);

  perform pg_temp.act_as(p);
  select count(*) filter (where url is not null and not media_hidden) into n
  from public.list_chat_media(x) where message_id = album;
  perform pg_temp.check('К2.7 вкладка «Медиа» у участника — как раньше', n = 2, n::text);

  -- ------------------------------------------------- К2.3: островок
  perform pg_temp.act_as(q);
  select count(*) filter (where media_hidden and url is null) into n
  from public.attachment_rows where message_id = album;
  perform pg_temp.check('К2.3 участник W (не X, не друг) в островке видит плитки', n = 2, n::text);
  perform pg_temp.check('К2.3 Q не открывает файлы A',
    not public.chat_media_object_readable(a_photo));

  -- ------------------------------------------------- К2.4: комментарий
  perform pg_temp.act_as(s);
  select * into r from public.comment_attachment_rows where comment_id = com;
  perform pg_temp.check('К2.4 S видит плитку на месте фото комментария A',
    r.media_hidden and r.url is null and r.width = 30);
  perform pg_temp.check('К2.4 S не открывает фото комментария',
    not public.chat_media_object_readable(a_comment_photo));
  perform pg_temp.act_as(q);
  perform pg_temp.check('К2.4 участник Z видит фото комментария к своему чату',
    (select url from public.comment_attachment_rows where comment_id = com) = a_comment_photo
      and public.chat_media_object_readable(a_comment_photo));

  -- ------------------------------------------------- К2.5: собеседник
  perform pg_temp.act_as(s);
  select * into r from public.attachment_rows where message_id = b_msg;
  perform pg_temp.check('К2.5 медиа B (всем) видно S рядом со скрытым A',
    r.url = b_photo and not r.media_hidden and public.chat_media_object_readable(b_photo));

  -- ------------------------------------------------- К2.6: смена настройки
  perform pg_temp.act_as(a);
  perform public.set_privacy_setting('dialogue_media_visibility', 'everyone');
  perform pg_temp.as_owner();
  perform pg_temp.check('К2.6 смена настройки — сигнал media_changed в топик X',
    exists (select 1 from realtime.messages rm where rm.topic = 'chat:' || x and rm.event = 'media_changed'));
  perform pg_temp.act_as(s);
  perform pg_temp.check('К2.6 «всем» — S видит и открывает',
    (select url from public.attachment_rows where message_id = album and mime_type = 'image/jpeg') = a_photo
      and public.chat_media_object_readable(a_photo));

  perform pg_temp.act_as(a);
  perform public.set_privacy_setting('dialogue_media_visibility', 'nobody');
  perform pg_temp.act_as(f);
  perform pg_temp.check('К2.6 «никому» — друг F видит плитки',
    (select bool_and(media_hidden) from public.attachment_rows where message_id = album)
      and not public.chat_media_object_readable(a_photo));
  perform pg_temp.act_as(p);
  perform pg_temp.check('К2.6 «никому» — участник P видит всё',
    (select bool_and(not media_hidden) from public.attachment_rows where message_id = album)
      and public.chat_media_object_readable(a_photo));
  perform pg_temp.act_as(a);
  perform pg_temp.check('К2.1 автор видит своё всегда',
    (select bool_and(not media_hidden) from public.attachment_rows where message_id in (album, voice))
      and public.chat_media_object_readable(a_photo));

  -- ------------------------------------------------- К2.7: канал — всем
  perform pg_temp.as_owner();
  insert into public.media_objects (bucket, path, owner_id, kind, mime_type, size_bytes)
  values ('chat-media', '00000000-0000-4000-8000-0000000005a1/photo/ch.jpg', a, 'photo', 'image/jpeg', 1);
  perform pg_temp.act_as(a);
  res := public.create_channel('Мед канал', 'medchannel5');
  channel := (res ->> 'channel_id')::uuid;
  posts := (res ->> 'chat_id')::uuid;
  album := public.send_media_message(posts, null, jsonb_build_array(
    jsonb_build_object('url', '00000000-0000-4000-8000-0000000005a1/photo/ch.jpg', 'mime_type', 'image/jpeg')
  ));
  perform pg_temp.act_as(s);
  perform pg_temp.check('К2.7 медиа поста канала видно всем — контент канала',
    (select bool_and(not media_hidden) from public.attachment_rows where message_id = album));

  -- ------------------------------------------------- К1.4: попсы и фото групп
  perform pg_temp.act_as(a);
  perform pg_temp.check('К1.4 поп с неочищенным видео — отказ OPN14',
    pg_temp.code_of(format($q$select public.publish_pop(%L, gen_random_uuid(), %L::jsonb, 'Поп')$q$, channel,
      jsonb_build_object('url', public_prefix || a::text || '/pops/x.mp4', 'poster_url', public_prefix || a::text || '/pops/x.jpg',
        'mime_type', 'video/mp4', 'width', 720, 'height', 1280, 'duration_ms', 1000))) = 'OPN14');
  perform pg_temp.as_owner();
  insert into storage.objects (bucket_id, name) values ('media', a::text || '/group-avatar/g1.jpg');
  perform pg_temp.act_as(a);
  perform pg_temp.check('К1.4 неочищенное фото группы — отказ OPN14',
    pg_temp.code_of(format($q$select public.set_chat_avatar(%L, %L)$q$,
      x, public_prefix || a::text || '/group-avatar/g1.jpg')) = 'OPN14');

  -- ------------------------------------------------- К1.5, К3.1
  perform pg_temp.as_owner();
  select array_agg(column_name::text order by column_name) into all_paths
  from information_schema.columns where table_schema = 'public' and table_name = 'media_objects';
  perform pg_temp.check('К1.5 реестр — путь, владелец, вид, тип, размер и время, без метаданных',
    all_paths = array['bucket', 'created_at', 'id', 'kind', 'mime_type', 'owner_id', 'path', 'sanitized_at', 'size_bytes'],
    array_to_string(all_paths, ','));
  perform pg_temp.check('К3.1 переключателя очистки нет — ни колонки, ни значения по умолчанию',
    not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'privacy_settings' and column_name = 'uploaded_media_metadata_stripping')
      and not (public.privacy_default_settings(true) ? 'uploaded_media_metadata_stripping'));
  perform pg_temp.check('К3.1 по умолчанию: подросток — друзьям, взрослый — всем',
    public.privacy_default_settings(true) ->> 'dialogue_media_visibility' = 'friends'
      and public.privacy_default_settings(false) ->> 'dialogue_media_visibility' = 'everyone');
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
