-- Сохранённые, этап 3: свои заметки и цитаты — только владельцу и только функциями.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/saved_notes_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000019a1', 'na@test.local', '{"full_name":"Автор A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000019b1', 'nb@test.local', '{"full_name":"Владелец B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000019e1', 'nz@test.local', '{"full_name":"Чужой Z"}', 'authenticated', 'authenticated');

update public.privacy_settings set dialogue_media_visibility = 'everyone', public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like 'n_@test.local');

insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000019a1', '00000000-0000-4000-8000-0000000019b1', 'accepted', now());

-- Очищенные файлы: B — свои, Z — свои. Неочищенный путь B в реестр не попадает.
insert into public.media_objects (bucket, path, owner_id, kind, mime_type, size_bytes) values
  ('chat-media', '00000000-0000-4000-8000-0000000019b1/photo/1.jpg', '00000000-0000-4000-8000-0000000019b1', 'photo', 'image/jpeg', 1),
  ('chat-media', '00000000-0000-4000-8000-0000000019b1/photo/2.jpg', '00000000-0000-4000-8000-0000000019b1', 'photo', 'image/jpeg', 1),
  ('chat-media', '00000000-0000-4000-8000-0000000019b1/video/3.mp4', '00000000-0000-4000-8000-0000000019b1', 'video', 'video/mp4', 1),
  ('chat-media', '00000000-0000-4000-8000-0000000019b1/poster/3.jpg', '00000000-0000-4000-8000-0000000019b1', 'poster', 'image/jpeg', 1),
  ('chat-media', '00000000-0000-4000-8000-0000000019b1/voice/4.m4a', '00000000-0000-4000-8000-0000000019b1', 'voice', 'audio/mp4', 1),
  ('chat-media', '00000000-0000-4000-8000-0000000019b1/video_note/5.mp4', '00000000-0000-4000-8000-0000000019b1', 'video_note', 'video/mp4', 1),
  ('chat-media', '00000000-0000-4000-8000-0000000019e1/photo/9.jpg', '00000000-0000-4000-8000-0000000019e1', 'photo', 'image/jpeg', 1);

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, coalesce(ok, false), detail) $$;

create function pg_temp.code_of(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'прошло';
exception when others then
  return sqlstate;
end;
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000019a1';
  b uuid := '00000000-0000-4000-8000-0000000019b1';
  z uuid := '00000000-0000-4000-8000-0000000019e1';
  grp uuid;
  m1 uuid;
  s_copy uuid;
  n_text uuid;
  n_album uuid;
  n_voice uuid;
  n_circle uuid;
  n_reply uuid;
  n_z uuid;
  k uuid := gen_random_uuid();
  ids uuid[];
  row_json jsonb;
  copies uuid[];
  photo1 jsonb;
  photo2 jsonb;
  keep uuid;
  total bigint;
begin
  perform pg_temp.act_as(a);
  grp := (public.create_chat(array[b], 'Группа') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  -- Друга создатель зовёт сразу участником; заявка — только если нет.
  if not exists (select 1 from public.chat_members where chat_id = grp and user_id = b) then
    perform public.accept_chat_invite(grp);
  end if;
  perform pg_temp.act_as(a);
  m1 := public.send_media_message(grp, 'оригинал', '[]'::jsonb);

  perform pg_temp.act_as(b);
  s_copy := (public.save_messages(grp, array[m1]))[1];

  photo1 := jsonb_build_object('url', b || '/photo/1.jpg', 'mime_type', 'image/jpeg', 'width', 100, 'height', 80);
  photo2 := jsonb_build_object('url', b || '/photo/2.jpg', 'mime_type', 'image/jpeg', 'width', 100, 'height', 80);

  -- ================================================== К1.1 — пишет и читает владелец
  n_text := public.send_saved_note(k, '  моя заметка  ');
  perform pg_temp.check('текстовая заметка: вид, текст, категория, автор — владелец',
    (select kind = 'text' and text = 'моя заметка' and source_type = 'note' and source_category = 'note'
       and source_chat_id is null and original_at is not null
     from public.saved_messages where id = n_text)
      and (select x.author_id = b and x.author_name = 'Владелец B' from public.list_saved_messages() x where x.id = n_text));

  n_album := public.send_saved_note(gen_random_uuid(), 'подпись', jsonb_build_array(photo1,
    jsonb_build_object('url', b || '/video/3.mp4', 'poster_url', b || '/poster/3.jpg', 'mime_type', 'video/mp4',
      'width', 640, 'height', 360, 'duration_ms', 5000)));
  perform pg_temp.check('альбом: два файла по порядку',
    (select kind = 'media' from public.saved_messages where id = n_album)
      and (select array_agg(url order by position) from public.saved_message_attachments where saved_id = n_album)
        = array[b || '/photo/1.jpg', b || '/video/3.mp4']);

  n_voice := public.send_saved_note(gen_random_uuid(), null, jsonb_build_array(jsonb_build_object(
    'url', b || '/voice/4.m4a', 'mime_type', 'audio/mp4', 'duration_ms', 3000, 'waveform', jsonb_build_array(1, 5, 31))), '{}', 'voice');
  perform pg_temp.check('голосовая: одна запись с волной',
    (select kind = 'voice' and text is null from public.saved_messages where id = n_voice)
      and (select waveform = array[1, 5, 31]::smallint[] from public.saved_message_attachments where saved_id = n_voice));

  n_circle := public.send_saved_note(gen_random_uuid(), null, jsonb_build_array(jsonb_build_object(
    'url', b || '/video_note/5.mp4', 'mime_type', 'video/mp4', 'width', 384, 'height', 384, 'duration_ms', 4000)), '{}', 'video_note');
  perform pg_temp.check('кружок: одно видео',
    (select kind = 'video_note' from public.saved_messages where id = n_circle));

  perform pg_temp.check('голосовая с подписью или двумя файлами — отказ',
    pg_temp.code_of(format($q$select public.send_saved_note(gen_random_uuid(), null, %L::jsonb, '{}', 'voice')$q$,
      jsonb_build_array(photo1))) = '23514');
  perform pg_temp.check('пустая заметка — отказ',
    pg_temp.code_of($q$select public.send_saved_note(gen_random_uuid(), '   ')$q$) = '23514');

  -- Отдельными шагами: чтение в том же выражении видело бы снимок до правки.
  perform public.set_saved_pinned(array[n_text], true);
  perform public.set_saved_watch_later(array[n_text], 'later');
  perform public.set_saved_tag(n_text, (select t.id from public.create_saved_tag('Мысли') t), true);
  perform pg_temp.check('видит владелец: тег, «Посмотреть позже», закреп работают',
    exists (select 1 from public.list_saved_messages() x where x.id = n_text and cardinality(x.tag_ids) = 1)
      and exists (select 1 from public.list_saved_pins() where id = n_text)
      and exists (select 1 from public.list_saved_watch_later() x where x.id = n_text));

  perform pg_temp.act_as(z);
  perform pg_temp.check('чужой не читает заметку ни одним способом',
    not exists (select 1 from public.saved_messages where id = n_text)
      and not exists (select 1 from public.saved_message_attachments where saved_id = n_album)
      and (select count(*) from public.list_saved_messages()) = 0
      and (select count(*) from public.list_saved_watch_later()) = 0
      and (select count(*) from public.list_saved_pins()) = 0
      and not exists (select 1 from public.saved_note_replies));
  perform pg_temp.check('чужой: правка, удаление, копия — отказ',
    pg_temp.code_of(format($q$select public.edit_saved_note(%L, 'взлом')$q$, n_text)) = 'P0002'
      and pg_temp.code_of(format($q$select public.delete_saved_messages(array[%L]::uuid[])$q$, n_text)) = 'P0002'
      and pg_temp.code_of(format($q$select public.copy_saved_notes(array[%L]::uuid[])$q$, n_text)) = 'P0002');
  perform pg_temp.check('чужой не читает файлы заметки',
    not public.chat_media_object_readable(b || '/photo/1.jpg'));

  perform pg_temp.act_as(b);
  perform pg_temp.check('владелец читает файлы заметки',
    public.chat_media_object_readable(b || '/photo/1.jpg'));
  perform pg_temp.check('прямая вставка заметки клиентом отказана',
    pg_temp.code_of(format($q$insert into public.saved_messages (owner_id, source_type, source_category, kind, text)
      values (%L, 'note', 'note', 'text', 'x')$q$, b)) = '42501');
  perform pg_temp.check('прямая правка заметки клиентом отказана',
    pg_temp.code_of(format($q$update public.saved_messages set text = 'x' where id = %L$q$, n_text)) = '42501');
  perform pg_temp.check('прямая вставка вложения и цитаты клиентом отказана',
    pg_temp.code_of(format($q$insert into public.saved_message_attachments (saved_id, owner_id, position, url)
      values (%L, %L, 5, 'x')$q$, n_text, b)) = '42501'
      and pg_temp.code_of(format($q$insert into public.saved_note_replies (owner_id, note_id, position, quoted_id)
      values (%L, %L, 0, %L)$q$, b, n_text, s_copy)) = '42501');

  -- ========================================== К1.2 — чужие файлы, цитаты, повтор
  perform pg_temp.check('чужой файл — отказ',
    pg_temp.code_of(format($q$select public.send_saved_note(gen_random_uuid(), null, %L::jsonb)$q$,
      jsonb_build_array(jsonb_build_object('url', z || '/photo/9.jpg', 'mime_type', 'image/jpeg')))) = 'OPN14');
  perform pg_temp.check('неочищенный файл — отказ',
    pg_temp.code_of(format($q$select public.send_saved_note(gen_random_uuid(), null, %L::jsonb)$q$,
      jsonb_build_array(jsonb_build_object('url', b || '/photo/raw.jpg', 'mime_type', 'image/jpeg')))) = 'OPN14');
  perform pg_temp.check('видео под видом фото — отказ',
    pg_temp.code_of(format($q$select public.send_saved_note(gen_random_uuid(), null, %L::jsonb)$q$,
      jsonb_build_array(jsonb_build_object('url', b || '/video/3.mp4', 'mime_type', 'image/jpeg')))) = 'OPN14');

  perform pg_temp.act_as(z);
  n_z := public.send_saved_note(gen_random_uuid(), 'заметка Z');
  perform pg_temp.act_as(b);
  perform pg_temp.check('цитата чужой записи — отказ',
    pg_temp.code_of(format($q$select public.send_saved_note(gen_random_uuid(), 'ответ', '[]', array[%L]::uuid[])$q$, n_z)) = 'P0002');
  perform pg_temp.check('повтор цитаты — отказ',
    pg_temp.code_of(format($q$select public.send_saved_note(gen_random_uuid(), 'ответ', '[]', array[%L, %L]::uuid[])$q$, s_copy, s_copy)) = '22023');

  total := (select count(*) from public.saved_messages where owner_id = b);
  perform pg_temp.check('повтор с тем же клиентским id — та же заметка, вторая не создана',
    public.send_saved_note(k, 'другой текст') = n_text
      and (select count(*) from public.saved_messages where owner_id = b) = total
      and (select text from public.saved_messages where id = n_text) = 'моя заметка');

  -- Ответ на копию и на свою заметку, в порядке на экране.
  n_reply := public.send_saved_note(gen_random_uuid(), 'ответ', '[]', array[s_copy, n_album]);
  select x.replies into row_json from public.list_saved_messages() x where x.id = n_reply;
  perform pg_temp.check('цитаты по порядку: id, номер, вид, текст, источник, превью файла',
    jsonb_array_length(row_json) = 2
      and (row_json -> 0 ->> 'saved_id')::uuid = s_copy
      and (row_json -> 0 ->> 'source_chat_id')::uuid = grp
      and row_json -> 0 ->> 'text' = 'оригинал'
      and (row_json -> 1 ->> 'saved_id')::uuid = n_album
      and row_json -> 1 ->> 'source_type' = 'note'
      and row_json -> 1 ->> 'kind' = 'media'
      and row_json -> 1 -> 'attachments' -> 0 ->> 'url' = b || '/photo/1.jpg'
      and (row_json -> 0 ->> 'seq')::bigint = (select seq from public.saved_messages where id = s_copy),
    row_json::text);
  perform pg_temp.check('у копии и простой заметки цитат нет, правки нет',
    (select x.replies = '[]'::jsonb and not x.edited from public.list_saved_messages() x where x.id = s_copy)
      and (select x.replies = '[]'::jsonb from public.list_saved_watch_later() x where x.id = n_text));

  -- ================================================== К1.3 — правка
  select id into keep from public.saved_message_attachments where saved_id = n_album and position = 1;
  perform public.edit_saved_note(n_album, 'новая подпись', array[keep]);
  perform pg_temp.check('правка: текст и оставленное вложение, пометка правки',
    (select text = 'новая подпись' and edited_at is not null from public.saved_messages where id = n_album)
      and (select array_agg(url order by position) from public.saved_message_attachments where saved_id = n_album)
        = array[b || '/video/3.mp4']
      and (select x.edited from public.list_saved_messages() x where x.id = n_album));
  perform public.edit_saved_note(n_album, 'только текст', '{}');
  perform pg_temp.check('альбом без файлов с текстом становится текстом',
    (select kind = 'text' from public.saved_messages where id = n_album));
  perform pg_temp.check('правка в пустоту — отказ, заметка как была',
    pg_temp.code_of(format($q$select public.edit_saved_note(%L, '  ')$q$, n_album)) = '23514'
      and (select text from public.saved_messages where id = n_album) = 'только текст');
  perform pg_temp.check('повтор вложения в списке правки — отказ',
    pg_temp.code_of(format($q$select public.edit_saved_note(%L, null, array[%L, %L]::uuid[])$q$, n_voice,
      (select id from public.saved_message_attachments where saved_id = n_voice),
      (select id from public.saved_message_attachments where saved_id = n_voice))) = '22023');
  perform pg_temp.check('правка без списка оставляет вложения',
    pg_temp.code_of(format($q$select public.edit_saved_note(%L, null)$q$, n_voice)) = 'прошло'
      and (select count(*) from public.saved_message_attachments where saved_id = n_voice) = 1);
  perform pg_temp.check('чужое вложение в списке — отказ',
    pg_temp.code_of(format($q$select public.edit_saved_note(%L, 'x', array[gen_random_uuid()])$q$, n_text)) = 'P0002');
  perform pg_temp.check('правка сохранённой копии — отказ, копия как была',
    pg_temp.code_of(format($q$select public.edit_saved_note(%L, 'подмена')$q$, s_copy)) = '42501'
      and (select text = 'оригинал' and edited_at is null from public.saved_messages where id = s_copy));

  -- Копия заметки «★ Сохранённые» из листа пересылки.
  copies := public.copy_saved_notes(array[n_voice, n_text], array[(select t.id from public.create_saved_tag('Идеи') t)], true);
  perform pg_temp.check('копии заметок: новые заметки с теми же файлами, без цитат, с тегом и «Посмотреть позже» из листа',
    cardinality(copies) = 2
      and (select kind = 'voice' and pinned_at is null and watch_later_at is not null from public.saved_messages where id = copies[1])
      and (select count(*) from public.saved_message_tags where saved_id = copies[1]) = 1
      and (select url from public.saved_message_attachments where saved_id = copies[1]) = b || '/voice/4.m4a'
      and (select text from public.saved_messages where id = copies[2]) = 'моя заметка');
  perform pg_temp.check('копировать сохранённую копию как заметку — отказ',
    pg_temp.code_of(format($q$select public.copy_saved_notes(array[%L]::uuid[])$q$, s_copy)) = '22023');

  -- Заметку можно отправить в чат обычным сообщением: файлы мои и очищены.
  perform pg_temp.check('файлы заметки уходят в чат сообщением без повторной загрузки',
    pg_temp.code_of(format($q$select public.send_media_message(%L, 'из заметки', %L::jsonb)$q$, grp,
      jsonb_build_array(photo2))) = 'прошло'
      and pg_temp.code_of(format($q$select public.send_voice_message(%L, %L::jsonb)$q$, grp,
      jsonb_build_object('url', b || '/voice/4.m4a', 'mime_type', 'audio/mp4', 'duration_ms', 3000))) = 'прошло');

  -- Удалить неотправленную по ключу: только свою и только заметку.
  perform pg_temp.act_as(z);
  perform pg_temp.check('чужой ключ: ничего не удалено',
    public.delete_saved_note_by_client(k) = 0);
  perform pg_temp.act_as(b);
  total := public.delete_saved_note_by_client(k);
  perform pg_temp.check('по ключу повтора заметка удалена',
    total = 1 and not exists (select 1 from public.saved_messages where id = n_text));

  -- ================================================== К1.4 — удаление цитируемой
  perform public.delete_saved_messages(array[s_copy]);
  select x.replies into row_json from public.list_saved_messages() x where x.id = n_reply;
  perform pg_temp.check('цитируемая удалена: заметка осталась, цитата — заглушка',
    exists (select 1 from public.saved_messages where id = n_reply)
      and jsonb_array_length(row_json) = 2
      and row_json -> 0 -> 'saved_id' = 'null'::jsonb
      and (row_json -> 1 ->> 'saved_id')::uuid = n_album,
    row_json::text);
  perform public.delete_saved_messages(array[n_reply]);
  perform pg_temp.check('удаление заметки уносит её цитаты',
    not exists (select 1 from public.saved_note_replies where note_id = n_reply));
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
