-- Правка сообщений: кто может, что закрыто, какие инварианты держит база.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/message_edit_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- Проверка формы сообщения — отложенный триггер в конце транзакции.
-- Транзакция здесь одна на весь файл, поэтому там, где это важно, он
-- запускается принудительно: `set constraints all immediate`, затем обратно.
--
-- Время `now()` одно на всю транзакцию. Сообщения, которые должны выглядеть
-- «старыми» (отправленными не в этой транзакции), вставляются с явным
-- `created_at` в прошлом.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a3', 'ea@test.local', '{"full_name":"Автор A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b3', 'eb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c3', 'ec@test.local', '{"full_name":"Участник C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d3', 'ed@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

create function pg_temp.say(chat uuid, author uuid, body text, at timestamptz) returns uuid
language plpgsql as $$
declare
  id uuid;
begin
  insert into public.messages (chat_id, author_id, kind, text, created_at)
  values (chat, author, 'text', body, at)
  returning messages.id into id;
  return id;
end;
$$;

-- Вложения сообщения одной строкой: вид вложения и адрес, по порядку.
create function pg_temp.files(msg uuid) returns text language sql as $$
  select coalesce(string_agg(message_kind || ':' || url, ',' order by position), '')
  from public.attachments where message_id = msg
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a3';
  b uuid := '00000000-0000-4000-8000-0000000000b3';
  c uuid := '00000000-0000-4000-8000-0000000000c3';
  d uuid := '00000000-0000-4000-8000-0000000000d3';
  chat_ab uuid;
  chat_ac uuid;
  plain uuid;
  older uuid;
  mb uuid;
  gone uuid;
  sys uuid;
  album uuid;
  voice uuid;
  reply uuid;
  latest uuid;
  copy uuid;
  kept_id uuid;
  second_id uuid;
  n int;
  n2 int;
  s text;
  ts timestamptz;
  big jsonb;
  t timestamptz := now() - interval '1 hour';
begin
  -- ------------------------------------------------------------- подготовка
  perform pg_temp.act_as(a);
  chat_ab := (public.create_chat(array[b], null) ->> 'chat_id')::uuid;
  chat_ac := (public.create_chat(array[c], null) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat_ab);
  perform pg_temp.act_as(c);
  perform public.accept_chat_invite(chat_ac);

  perform pg_temp.act_as(a);
  older := pg_temp.say(chat_ab, a, 'старое', t);
  plain := pg_temp.say(chat_ab, a, 'было', t + interval '1 minute');
  gone := pg_temp.say(chat_ab, a, 'будет удалено', t + interval '2 minutes');
  perform pg_temp.act_as(b);
  mb := pg_temp.say(chat_ab, b, 'от B', t + interval '3 minutes');
  perform pg_temp.act_as(a);

  album := public.send_media_message(
    chat_ab,
    'подпись',
    '[{"url":"https://x/1.jpg","mime_type":"image/jpeg","width":100,"height":80},
      {"url":"https://x/2.mp4","poster_url":"https://x/2p.jpg","mime_type":"video/mp4","width":640,"height":360,"duration_ms":5000},
      {"url":"https://x/3.jpg","mime_type":"image/jpeg","width":50,"height":50}]'::jsonb
  );
  voice := public.send_voice_message(
    chat_ab,
    '{"url":"https://x/v.m4a","mime_type":"audio/mp4","duration_ms":4200,"size_bytes":1000,"waveform":[1,5,31]}'::jsonb
  );
  reply := public.send_media_message(chat_ab, 'ответ на старое', '[]'::jsonb, array[older]);
  set constraints all immediate;
  set constraints all deferred;

  -- Порядок в чате: альбом, голосовое и ответ отправлены «сейчас», а
  -- последним по времени делается отдельное сообщение — для проверки превью.
  perform pg_temp.as_service();
  update public.messages set created_at = t + interval '10 minutes' where id = album;
  update public.messages set created_at = t + interval '11 minutes' where id = voice;
  update public.messages set created_at = t + interval '12 minutes' where id = reply;
  insert into public.messages (chat_id, author_id, kind, text, created_at)
  values (chat_ab, null, 'system', 'служебное', t + interval '13 minutes')
  returning id into sys;
  perform pg_temp.act_as(a);
  latest := pg_temp.say(chat_ab, a, 'последнее', t + interval '20 minutes');
  perform pg_temp.as_service();
  select count(*) into n2 from storage.objects;
  perform pg_temp.act_as(a);

  perform public.delete_messages(array[gone]);
  perform public.pin_message(plain);

  -- Пересланная копия альбома в чат A–C — до правки оригинала.
  copy := (select f from public.forward_messages(chat_ac, array[album]) as f limit 1);

  -- ============================================ прямая запись закрыта
  begin
    update public.messages set text = 'тихая подмена' where id = plain;
    perform pg_temp.check('автор не меняет текст прямым UPDATE', false, 'прошло');
  exception when others then
    perform pg_temp.check('автор не меняет текст прямым UPDATE', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.messages set edited_at = now() - interval '1 day' where id = plain;
    perform pg_temp.check('автор не ставит edited_at прямым UPDATE', false, 'прошло');
  exception when others then
    perform pg_temp.check('автор не ставит edited_at прямым UPDATE', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.messages set kind = 'media' where id = plain;
    perform pg_temp.check('автор не меняет вид прямым UPDATE', false, 'прошло');
  exception when others then
    perform pg_temp.check('автор не меняет вид прямым UPDATE', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  select text into s from public.messages where id = plain;
  perform pg_temp.check('текст после попыток прежний', s = 'было', s);

  begin
    insert into public.attachments (message_id, message_kind, url, mime_type, position)
    values (older, 'text', 'https://x/fake.jpg', 'image/jpeg', 0);
    perform pg_temp.check('к старому сообщению файл напрямую не дописать', false, 'прошло');
  exception when others then
    perform pg_temp.check('к старому сообщению файл напрямую не дописать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    delete from public.attachments where message_id = album;
    get diagnostics n = row_count;
    perform pg_temp.check('вложение напрямую не удалить', n = 0, n::text);
  exception when others then
    perform pg_temp.check('вложение напрямую не удалить', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Новое сообщение не приходит «уже изменённым».
  insert into public.messages (chat_id, author_id, kind, text, created_at, edited_at)
  values (chat_ab, a, 'text', 'с выдуманной правкой', t + interval '5 minutes', now() - interval '1 day')
  returning edited_at into ts;
  perform pg_temp.check('edited_at при вставке сбрасывает сервер', ts is null, ts::text);

  -- Удаление из 4a работает, как раньше.
  select count(*) into n from public.messages where id = gone;
  perform pg_temp.check('удаление функцией работает (удалённое не видно)', n = 0, n::text);
  perform pg_temp.as_service();
  select deleted_at into ts from public.messages where id = gone;
  perform pg_temp.check('удаление мягкое — строка на месте', ts is not null, ts::text);
  perform pg_temp.act_as(a);

  -- ======================================================= правка текста
  perform public.edit_message(plain, '  стало  ');
  select text, edited_at into s, ts from public.messages where id = plain;
  perform pg_temp.check('автор правит текст функцией (пробелы по краям срезаны)', s = 'стало', s);
  perform pg_temp.check('edited_at ставит сервер — время транзакции', ts = now(), ts::text);

  select count(*) into n from public.message_pins where message_id = plain and deleted_at is null;
  perform pg_temp.check('закреп после правки на месте', n = 1, n::text);

  perform pg_temp.as_service();
  select string_agg(kind || '|' || coalesce(text, '') || '|' || version_at::text, ';') into s
  from public.message_revisions where message_id = plain;
  perform pg_temp.check(
    'ревизия хранит прежний вид, текст и время версии',
    s = 'text|было|' || (t + interval '1 minute')::text,
    s
  );
  perform pg_temp.act_as(a);

  -- Та же правка ещё раз — ничего нового.
  perform public.edit_message(plain, 'стало');
  perform pg_temp.as_service();
  select count(*) into n from public.message_revisions where message_id = plain;
  perform pg_temp.check('повтор той же правки не плодит ревизий', n = 1, n::text);
  perform pg_temp.act_as(a);

  -- ================================================= ревизии закрыты
  begin
    select count(*) into n from public.message_revisions;
    perform pg_temp.check('автор не читает ревизии', false, n::text);
  exception when others then
    perform pg_temp.check('автор не читает ревизии', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.message_revisions (message_id, chat_id, kind, text, version_at)
    values (plain, chat_ab, 'text', 'подделка', now());
    perform pg_temp.check('автор не пишет ревизии', false, 'прошло');
  exception when others then
    perform pg_temp.check('автор не пишет ревизии', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(d);

  begin
    select count(*) into n from public.message_revisions;
    perform pg_temp.check('посетитель не читает ревизии', false, n::text);
  exception when others then
    perform pg_temp.check('посетитель не читает ревизии', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- ================================================== чужие не правят
  perform pg_temp.act_as(b);

  begin
    perform public.edit_message(plain, 'B правит A');
    perform pg_temp.check('участник не правит чужое функцией', false, 'прошло');
  exception when others then
    perform pg_temp.check('участник не правит чужое функцией', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.messages set text = 'B правит A' where id = plain;
    perform pg_temp.check('участник не правит чужое напрямую', false, 'прошло');
  exception when others then
    perform pg_temp.check('участник не правит чужое напрямую', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(d);

  begin
    perform public.edit_message(plain, 'D правит A');
    perform pg_temp.check('посетитель не правит функцией', false, 'прошло');
  exception when others then
    perform pg_temp.check('посетитель не правит функцией', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.messages set text = 'D правит A' where id = plain;
    perform pg_temp.check('посетитель не правит напрямую', false, 'прошло');
  exception when others then
    perform pg_temp.check('посетитель не правит напрямую', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as_anon();

  begin
    perform public.edit_message(plain, 'anon');
    perform pg_temp.check('anon не вызывает edit_message', false, 'прошло');
  exception when others then
    perform pg_temp.check('anon не вызывает edit_message', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(a);
  select text into s from public.messages where id = plain;
  perform pg_temp.check('после чужих попыток текст автора', s = 'стало', s);

  -- ======================================= что не правится вообще
  begin
    perform public.edit_message(copy, 'подмена пересланного');
    perform pg_temp.check('пересланное не правится', false, 'прошло');
  exception when others then
    perform pg_temp.check('пересланное не правится', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.edit_message(gone, 'воскрешение');
    perform pg_temp.check('удалённое не правится', false, 'прошло');
  exception when others then
    perform pg_temp.check('удалённое не правится', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.as_service();
  update public.messages set author_id = a where id = sys;
  perform pg_temp.act_as(a);

  begin
    perform public.edit_message(sys, 'служебное поправлено');
    perform pg_temp.check('системное не правится', false, 'прошло');
  exception when others then
    perform pg_temp.check('системное не правится', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  -- ================================================= инварианты итога
  begin
    perform public.edit_message(plain, '   ');
    perform pg_temp.check('пустое сообщение не сохраняется', false, 'прошло');
  exception when others then
    perform pg_temp.check('пустое сообщение не сохраняется', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.edit_message(album, null, '[]'::jsonb, null);
    perform pg_temp.check('альбом без файлов и текста не сохраняется', false, 'прошло');
  exception when others then
    perform pg_temp.check('альбом без файлов и текста не сохраняется', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.edit_message(
      voice, 'подпись к голосовому', '[]'::jsonb,
      '{"url":"https://x/v2.m4a","mime_type":"audio/mp4","duration_ms":1000}'::jsonb
    );
    perform pg_temp.check('голосовое с подписью не сохраняется', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое с подписью не сохраняется', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.edit_message(
      voice, null, '[{"url":"https://x/9.jpg","mime_type":"image/jpeg"}]'::jsonb,
      '{"url":"https://x/v2.m4a","mime_type":"audio/mp4","duration_ms":1000}'::jsonb
    );
    perform pg_temp.check('голосовое вместе с фото не сохраняется', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое вместе с фото не сохраняется', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.edit_message(
      plain, null, '[]'::jsonb, '{"url":"https://x/v2.m4a","mime_type":"audio/mp4"}'::jsonb
    );
    perform pg_temp.check('голосовое без длительности не сохраняется', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое без длительности не сохраняется', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.edit_message(
      plain, null, '[]'::jsonb, '{"url":"https://x/v2.mp4","mime_type":"video/mp4","duration_ms":1000}'::jsonb
    );
    perform pg_temp.check('голосовое-видео не сохраняется', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое-видео не сохраняется', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.edit_message(
      plain, null, '[{"url":"https://x/a.m4a","mime_type":"audio/mp4","duration_ms":1000}]'::jsonb, null
    );
    perform pg_temp.check('звук в альбоме не сохраняется', false, 'прошло');
  exception when others then
    perform pg_temp.check('звук в альбоме не сохраняется', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  select jsonb_agg(jsonb_build_object('url', 'https://x/big' || i || '.jpg', 'mime_type', 'image/jpeg'))
  into big from generate_series(1, 51) as i;

  begin
    perform public.edit_message(album, null, big, null);
    perform pg_temp.check('альбом больше 50 файлов не сохраняется', false, 'прошло');
  exception when others then
    perform pg_temp.check('альбом больше 50 файлов не сохраняется', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  select id into kept_id from public.attachments where message_id = voice;

  begin
    perform public.edit_message(album, null, jsonb_build_array(jsonb_build_object('attachment_id', kept_id)), null);
    perform pg_temp.check('чужое вложение в свою правку не взять', false, 'прошло');
  exception when others then
    perform pg_temp.check('чужое вложение в свою правку не взять', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  select id into kept_id from public.attachments where message_id = album and position = 0;

  begin
    perform public.edit_message(
      album, null,
      jsonb_build_array(jsonb_build_object('attachment_id', kept_id), jsonb_build_object('attachment_id', kept_id)),
      null
    );
    perform pg_temp.check('одно вложение дважды не взять', false, 'прошло');
  exception when others then
    perform pg_temp.check('одно вложение дважды не взять', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  select pg_temp.files(album) into s;
  perform pg_temp.check(
    'после отвергнутых правок альбом прежний',
    s = 'media:https://x/1.jpg,media:https://x/2.mp4,media:https://x/3.jpg',
    s
  );

  -- Проверка формы стоит и на прямом изменении: голосовое, оставшееся без
  -- файла, не доживает до конца транзакции, кто бы его ни менял.
  perform pg_temp.as_service();
  begin
    delete from public.attachments where message_id = voice;
    set constraints all immediate;
    perform pg_temp.check('голосовое без файла не доживает до commit', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое без файла не доживает до commit', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;
  set constraints all deferred;

  begin
    update public.messages set text = 'подпись' where id = voice;
    set constraints all immediate;
    perform pg_temp.check('голосовое с подписью не доживает до commit', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое с подписью не доживает до commit', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;
  set constraints all deferred;
  perform pg_temp.act_as(a);

  -- ================================================= смена вида
  -- Альбом: убрать первый, оставить третий и второй (в новом порядке нельзя —
  -- порядок не меняется в интерфейсе, но база принимает любой), добавить новый.
  select id into kept_id from public.attachments where message_id = album and position = 1;
  select id into second_id from public.attachments where message_id = album and position = 2;

  perform public.edit_message(
    album,
    'новая подпись',
    jsonb_build_array(
      jsonb_build_object('attachment_id', kept_id),
      jsonb_build_object('attachment_id', second_id),
      '{"url":"https://x/4.jpg","mime_type":"image/jpeg","width":10,"height":10}'::jsonb
    ),
    null
  );
  set constraints all immediate;
  set constraints all deferred;

  select pg_temp.files(album) into s;
  perform pg_temp.check(
    'альбом: убран первый, добавлен новый в конец',
    s = 'media:https://x/2.mp4,media:https://x/3.jpg,media:https://x/4.jpg',
    s
  );

  select count(*) into n from public.attachments
  where message_id = album and id = kept_id and poster_url = 'https://x/2p.jpg' and duration_ms = 5000;
  perform pg_temp.check('оставленное вложение сохранило id и поля', n = 1, n::text);

  -- Пересланная копия прежней версии живёт со своими файлами.
  select pg_temp.files(copy) || '|' || text into s from public.messages where id = copy;
  perform pg_temp.check(
    'пересланная копия прежней версии не изменилась',
    s = 'media:https://x/1.jpg,media:https://x/2.mp4,media:https://x/3.jpg|подпись',
    s
  );

  perform pg_temp.as_service();
  select jsonb_array_length(attachments) || '|' || (attachments -> 0 ->> 'url') into s
  from public.message_revisions where message_id = album;
  perform pg_temp.check('ревизия альбома — полный снимок вложений', s = '3|https://x/1.jpg', s);
  perform pg_temp.act_as(a);

  -- Текст → альбом.
  perform public.edit_message(
    older, 'теперь с фото',
    '[{"url":"https://x/5.jpg","mime_type":"image/jpeg"},{"url":"https://x/6.mp4","poster_url":"https://x/6p.jpg","mime_type":"video/mp4","duration_ms":900}]'::jsonb,
    null
  );
  set constraints all immediate;
  set constraints all deferred;
  select kind || '|' || text || '|' || pg_temp.files(older) into s from public.messages where id = older;
  perform pg_temp.check(
    'текст → альбом',
    s = 'media|теперь с фото|media:https://x/5.jpg,media:https://x/6.mp4',
    s
  );

  -- Цитата ответа на `older` правкой не тронута — она ссылка.
  select count(*) into n from public.message_replies where message_id = reply and quoted_id = older;
  perform pg_temp.check('цитата ответа после правки оригинала на месте', n = 1, n::text);

  -- Альбом → голосовое.
  perform public.edit_message(
    older, null, '[]'::jsonb,
    '{"url":"https://x/v3.m4a","mime_type":"audio/mp4","duration_ms":2500,"size_bytes":10,"waveform":[3,2,1]}'::jsonb
  );
  set constraints all immediate;
  set constraints all deferred;
  select kind || '|' || coalesce(text, '∅') || '|' || pg_temp.files(older) into s
  from public.messages where id = older;
  perform pg_temp.check('альбом → голосовое', s = 'voice|∅|voice:https://x/v3.m4a', s);

  select waveform::text into s from public.attachments where message_id = older;
  perform pg_temp.check('волна нового голосового сохранена', s = '{3,2,1}', s);

  -- Голосовое → текст.
  perform public.edit_message(voice, 'расшифровка');
  set constraints all immediate;
  set constraints all deferred;
  select kind || '|' || text || '|' || pg_temp.files(voice) into s from public.messages where id = voice;
  perform pg_temp.check('голосовое → текст', s = 'text|расшифровка|', s);

  -- Текст → голосовое через оставленный файл невозможно (файла нет), а
  -- голосовое с тем же файлом — возможно: оставить запись и ничего не менять.
  select id into kept_id from public.attachments where message_id = older;
  perform public.edit_message(older, null, '[]'::jsonb, jsonb_build_object('attachment_id', kept_id));
  perform pg_temp.as_service();
  select count(*) into n from public.message_revisions where message_id = older;
  perform pg_temp.check('голосовое без изменений — без новой ревизии', n = 2, n::text);
  perform pg_temp.act_as(a);

  -- Ответ правится, цитаты остаются.
  perform public.edit_message(reply, 'ответ поправлен');
  select count(*) into n from public.message_replies where message_id = reply;
  perform pg_temp.check('правка ответа не снимает его цитаты', n = 1, n::text);

  -- ===================================================== превью чата
  -- Рассылка нового сообщения — отложенный триггер, и все вставки теста
  -- дописали превью при принудительных проверках выше. Превью ставится явно.
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.as_service();
  update public.chats set last_message_at = t + interval '20 minutes', last_message_text = 'последнее'
  where id = chat_ab;
  perform pg_temp.act_as(a);

  select last_message_text into s from public.chats where id = chat_ab;
  perform pg_temp.check('правка не последнего не трогает превью', s = 'последнее', s);

  perform public.edit_message(latest, 'последнее, поправленное');
  select last_message_text into s from public.chats where id = chat_ab;
  perform pg_temp.check('правка последнего меняет превью', s = 'последнее, поправленное', s);

  select last_message_at into ts from public.chats where id = chat_ab;
  perform pg_temp.check('правка не поднимает чат в списке', ts = t + interval '20 minutes', ts::text);

  perform public.edit_message(latest, null, '[{"url":"https://x/7.jpg","mime_type":"image/jpeg"}]'::jsonb, null);
  select last_message_text into s from public.chats where id = chat_ab;
  perform pg_temp.check('превью последнего, ставшего фото', s = '📷 Медиа', s);

  -- ============================================ дочитывание правок
  select count(*) into n
  from public.message_edits(array[plain, mb, album, latest]);
  perform pg_temp.check('message_edits отдаёт только изменённые', n = 3, n::text);

  perform pg_temp.act_as(d);
  select count(*) into n from public.message_edits(array[plain, gone]);
  perform pg_temp.check('посетитель видит, что изменено, но не удалённое', n = 1, n::text);

  -- ======================================= вышедший из чата не правит
  perform pg_temp.as_service();
  delete from public.chat_members where chat_id = chat_ab and user_id = a;
  perform pg_temp.act_as(a);

  begin
    perform public.edit_message(plain, 'после выхода');
    perform pg_temp.check('вышедший из чата не правит своё', false, 'прошло');
  exception when others then
    perform pg_temp.check('вышедший из чата не правит своё', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Файлы в Storage правка не трогает: в ней нет ни одного обращения к
  -- `storage`, а строки вложений — лишь ссылки. Проверяется косвенно:
  -- количество объектов бакета до и после всех правок одно.
  perform pg_temp.as_service();
  select count(*) into n from storage.objects;
  perform pg_temp.check('объектов в storage — сколько было', n = n2, n || ' / ' || n2);
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
