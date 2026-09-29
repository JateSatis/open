-- Ответы и пересылка: кто может, кто нет, что копируется и что нельзя подделать.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/replies_and_forwards_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- Инварианты голосового проверяет отложенный триггер в конце транзакции.
-- Транзакция здесь одна на весь файл, поэтому после вставок он запускается
-- принудительно: `set constraints all immediate`, затем обратно в отложенный.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a2', 'ra@test.local', '{"full_name":"Автор A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b2', 'rb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c2', 'rc@test.local', '{"full_name":"Участник C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d2', 'rd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000e2', 're@test.local', '{"full_name":"Приглашённый E"}', 'authenticated', 'authenticated');

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

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a2';
  b uuid := '00000000-0000-4000-8000-0000000000b2';
  c uuid := '00000000-0000-4000-8000-0000000000c2';
  d uuid := '00000000-0000-4000-8000-0000000000d2';
  e uuid := '00000000-0000-4000-8000-0000000000e2';
  chat_ab uuid;
  chat_ac uuid;
  chat_dc uuid;
  m1 uuid;
  m2 uuid;
  m3 uuid;
  gone uuid;
  other_chat_msg uuid;
  reply uuid;
  album uuid;
  voice uuid;
  copies uuid[];
  second_copies uuid[];
  n int;
  s text;
  ok boolean;
  t timestamptz := now() - interval '1 hour';
begin
  -- ------------------------------------------------------------- подготовка
  perform pg_temp.act_as(a);
  -- E позван в чат A–B, но заявку не принял: писать туда он не может.
  chat_ab := (public.create_chat(array[b, e], null) ->> 'chat_id')::uuid;
  chat_ac := (public.create_chat(array[c], null) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(d);
  chat_dc := (public.create_chat(array[c], null) ->> 'chat_id')::uuid;

  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat_ab);
  perform pg_temp.act_as(c);
  perform public.accept_chat_invite(chat_ac);
  perform public.accept_chat_invite(chat_dc);

  perform pg_temp.act_as(a);
  m1 := pg_temp.say(chat_ab, a, 'первое A', t);
  m2 := pg_temp.say(chat_ab, a, 'второе A', t + interval '1 minute');
  gone := pg_temp.say(chat_ab, a, 'будет удалено', t + interval '2 minutes');
  other_chat_msg := pg_temp.say(chat_ac, a, 'в другом чате', t);
  perform public.delete_messages(array[gone]);

  album := public.send_media_message(
    chat_ab,
    'подпись альбома',
    '[{"url":"https://x/1.jpg","mime_type":"image/jpeg","width":100,"height":80},
      {"url":"https://x/2.mp4","poster_url":"https://x/2.jpg","mime_type":"video/mp4","width":640,"height":360,"duration_ms":5000},
      {"url":"https://x/3.jpg","mime_type":"image/jpeg","width":50,"height":50}]'::jsonb
  );
  voice := public.send_voice_message(
    chat_ab,
    '{"url":"https://x/v.m4a","mime_type":"audio/mp4","duration_ms":4200,"size_bytes":1000,"waveform":[1,5,31,0,7]}'::jsonb
  );
  set constraints all immediate;
  set constraints all deferred;

  -- Альбом и голосовое отправлены в одной транзакции теста, и время у них
  -- одно (`now()`); голосовое сдвигается, чтобы порядок оригиналов был явным.
  perform set_config('role', 'postgres', true);
  update public.messages set created_at = now() + interval '1 second' where id = voice;

  -- ========================================================= ответ: разрешено
  perform pg_temp.act_as(b);
  reply := public.send_media_message(chat_ab, 'отвечаю', '[]'::jsonb, array[m1]);
  select count(*) into n from public.message_replies where message_id = reply and quoted_id = m1 and position = 0;
  perform pg_temp.check('участник отвечает текстом на чужое', n = 1, n::text);

  select kind into s from public.messages where id = reply;
  perform pg_temp.check('текстовый ответ — вид text', s = 'text', s);

  reply := public.send_media_message(chat_ab, 'на оба', '[]'::jsonb, array[m2, m1]);

  select string_agg(quoted_id::text, ',' order by position) = m2::text || ',' || m1::text into ok
  from public.message_replies where message_id = reply;
  perform pg_temp.check('ответ на несколько — порядок цитат сохранён', ok, null);

  perform pg_temp.act_as(a);
  reply := public.send_media_message(chat_ab, 'сам себе', '[]'::jsonb, array[m2]);
  perform pg_temp.check('ответ на своё сообщение', exists (select 1 from public.message_replies where message_id = reply), null);

  reply := public.send_media_message(
    chat_ab, null, '[{"url":"https://x/r.jpg","mime_type":"image/jpeg"}]'::jsonb, array[m1]
  );
  perform pg_temp.check('ответ альбомом', exists (select 1 from public.message_replies where message_id = reply and quoted_id = m1), null);

  reply := public.send_voice_message(
    chat_ab,
    '{"url":"https://x/rv.m4a","mime_type":"audio/mp4","duration_ms":1000,"size_bytes":10}'::jsonb,
    array[album, voice]
  );
  set constraints all immediate;
  set constraints all deferred;
  select count(*) into n from public.message_replies where message_id = reply;
  perform pg_temp.check('ответ голосовым на альбом и голосовое', n = 2, n::text);

  -- ========================================================== ответ: запреты
  begin
    perform public.send_media_message(chat_ab, 'чужой чат', '[]'::jsonb, array[other_chat_msg]);
    perform pg_temp.check('ответ на сообщение из другого чата отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('ответ на сообщение из другого чата отвергается', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_media_message(chat_ab, 'удалённое', '[]'::jsonb, array[gone]);
    perform pg_temp.check('ответ на удалённое отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('ответ на удалённое отвергается', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_voice_message(
      chat_ab,
      '{"url":"https://x/g.m4a","mime_type":"audio/mp4","duration_ms":1000}'::jsonb,
      array[gone]
    );
    perform pg_temp.check('голосовой ответ на удалённое отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовой ответ на удалённое отвергается', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_media_message(chat_ab, 'дважды', '[]'::jsonb, array[m1, m1]);
    perform pg_temp.check('одна цитата дважды отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('одна цитата дважды отвергается', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(d);
  begin
    perform public.send_media_message(chat_ab, 'посетитель', '[]'::jsonb, array[m1]);
    perform pg_temp.check('посетитель не отвечает', false, 'прошло');
  exception when others then
    perform pg_temp.check('посетитель не отвечает', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(e);
  begin
    perform public.send_media_message(chat_ab, 'приглашённый', '[]'::jsonb, array[m1]);
    perform pg_temp.check('приглашённый, но не принявший, не отвечает', false, 'прошло');
  exception when others then
    perform pg_temp.check('приглашённый, но не принявший, не отвечает', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Прямые вставки ссылок: к старому сообщению, к чужому, к удалённому.
  perform pg_temp.act_as(a);
  begin
    insert into public.message_replies (chat_id, message_id, quoted_id, position)
    values (chat_ab, m2, m1, 0);
    perform pg_temp.check('цитату к старому своему сообщению не дописать', false, 'прошло');
  exception when others then
    perform pg_temp.check('цитату к старому своему сообщению не дописать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(b);
  begin
    insert into public.message_replies (chat_id, message_id, quoted_id, position)
    values (chat_ab, album, m1, 5);
    perform pg_temp.check('цитату к чужому сообщению не дописать', false, 'прошло');
  exception when others then
    perform pg_temp.check('цитату к чужому сообщению не дописать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(a);
  begin
    perform public.add_message_replies(m1, chat_ab, array[album]);
    perform pg_temp.check('функцией цитату к старому сообщению не дописать', false, 'прошло');
  exception when others then
    perform pg_temp.check('функцией цитату к старому сообщению не дописать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Та же проверка без RLS — «только тот же чат» держит схема, а не политика.
  perform set_config('role', 'postgres', true);
  begin
    insert into public.message_replies (chat_id, message_id, quoted_id, position)
    values (chat_ab, m2, other_chat_msg, 0);
    perform pg_temp.check('схема: цитата из другого чата отвергается внешним ключом', false, 'прошло');
  exception when others then
    perform pg_temp.check('схема: цитата из другого чата отвергается внешним ключом', sqlstate = '23503', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(b);
  begin
    update public.message_replies set quoted_id = m2 where quoted_id = m1;
    get diagnostics n = row_count;
    perform pg_temp.check('ссылки ответа не меняются', n = 0, n::text);
  exception when others then
    perform pg_temp.check('ссылки ответа не меняются', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    delete from public.message_replies where quoted_id = m1;
    get diagnostics n = row_count;
    perform pg_temp.check('ссылки ответа не удаляются', n = 0, n::text);
  exception when others then
    perform pg_temp.check('ссылки ответа не удаляются', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Цитата удалённого: ссылка остаётся, сам оригинал обычной выборкой не отдаётся.
  perform pg_temp.act_as(a);
  reply := public.send_media_message(chat_ab, 'про второе', '[]'::jsonb, array[m2]);
  perform public.delete_messages(array[m2]);
  perform pg_temp.act_as(d);
  select count(*) into n
  from public.message_replies r
  join public.messages q on q.id = r.quoted_id
  where r.message_id = reply;
  perform pg_temp.check('цитата удалённого: оригинал посетителю не отдаётся', n = 0, n::text);
  select count(*) into n from public.message_replies where message_id = reply;
  perform pg_temp.check('цитата удалённого: ссылка видна и посетителю', n = 1, n::text);

  -- ===================================================== пересылка: разрешено
  -- Посетитель D пересылает чужую переписку A–B в свой чат с C.
  perform pg_temp.act_as(d);
  select array_agg(id) into copies
  from public.forward_messages(chat_dc, array[voice, m1, album]) as f(id);
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.check('посетитель пересылает из чужого чата в свой', cardinality(copies) = 3, cardinality(copies)::text);

  select bool_and(m.author_id = d and m.chat_id = chat_dc) into ok
  from public.messages m where m.id = any (copies);
  perform pg_temp.check('автор копий — переславший, чат — целевой', ok, null);

  -- Порядок — как у оригиналов в переписке, а не как в запросе.
  select string_agg(coalesce(text, kind), ',' order by created_at) into s
  from public.messages where id = any (copies);
  perform pg_temp.check('копии в исходном порядке', s = 'первое A,подпись альбома,voice', s);

  select string_agg(f.origin_author_id::text, ',') into s
  from public.message_forwards f where f.message_id = any (copies);
  select bool_and(f.origin_author_id = a) into ok
  from public.message_forwards f where f.message_id = any (copies);
  perform pg_temp.check('атрибуция: автор оригинала', ok, s);

  select count(*) into n
  from public.message_forwards f
  where f.message_id = copies[2] and f.origin_message_id = album;
  perform pg_temp.check('атрибуция: ссылка на оригинал', n = 1, n::text);

  select string_agg(a.url || '|' || coalesce(a.poster_url, '-') || '|' || a.position, ';' order by a.position) into s
  from public.attachments a where a.message_id = copies[2];
  perform pg_temp.check(
    'альбом: те же файлы, постеры и порядок',
    s = 'https://x/1.jpg|-|0;https://x/2.mp4|https://x/2.jpg|1;https://x/3.jpg|-|2',
    s
  );

  select kind into s from public.messages where id = copies[2];
  perform pg_temp.check('альбом остаётся альбомом', s = 'media', s);

  select a.waveform::text || '|' || a.duration_ms || '|' || m.kind into s
  from public.attachments a join public.messages m on m.id = a.message_id
  where a.message_id = copies[3];
  perform pg_temp.check('голосовое: волна, длительность, вид', s = '{1,5,31,0,7}|4200|voice', s);

  select last_message_text into s from public.chats where id = chat_dc;
  perform pg_temp.check('превью пересланного — как у обычного', s = '🎤 Голосовое сообщение (0:04)', s);

  select count(*) into n from public.message_replies where message_id = any (copies);
  perform pg_temp.check('цитаты ответа при пересылке не переносятся', n = 0, n::text);

  -- Пересылка пересланного указывает первоисточник.
  perform pg_temp.act_as(c);
  select array_agg(id) into second_copies
  from public.forward_messages(chat_ac, array[copies[1]]) as f(id);
  select count(*) into n
  from public.message_forwards f
  where f.message_id = second_copies[1] and f.origin_message_id = m1 and f.origin_author_id = a;
  perform pg_temp.check('пересылка пересланного — первоисточник', n = 1, n::text);

  -- Пересылать можно и в тот же чат.
  perform pg_temp.act_as(b);
  select array_agg(id) into second_copies
  from public.forward_messages(chat_ab, array[m1]) as f(id);
  perform pg_temp.check('пересылка в тот же чат', cardinality(second_copies) = 1, null);

  -- Пересланный ответ: цитата не переезжает.
  select array_agg(id) into second_copies
  from public.forward_messages(chat_ab, array[(select message_id from public.message_replies where quoted_id = m1 limit 1)]) as f(id);
  select count(*) into n from public.message_replies where message_id = second_copies[1];
  perform pg_temp.check('пересланный ответ — без цитаты', n = 0, n::text);

  -- Оригинал удалили — копия живёт.
  perform pg_temp.act_as(a);
  perform public.delete_messages(array[m1]);
  perform pg_temp.act_as(c);
  select count(*) into n from public.messages where id = copies[1];
  perform pg_temp.check('копия живёт после удаления оригинала', n = 1, n::text);

  -- ======================================================= пересылка: запреты
  perform pg_temp.act_as(d);
  begin
    perform public.forward_messages(chat_ab, array[album]);
    perform pg_temp.check('в чат, где не участник, переслать нельзя', false, 'прошло');
  exception when others then
    perform pg_temp.check('в чат, где не участник, переслать нельзя', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(e);
  begin
    perform public.forward_messages(chat_ab, array[album]);
    perform pg_temp.check('в чат, куда только приглашён, переслать нельзя', false, 'прошло');
  exception when others then
    perform pg_temp.check('в чат, куда только приглашён, переслать нельзя', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(b);
  begin
    perform public.forward_messages(chat_ab, array[gone]);
    perform pg_temp.check('удалённое переслать нельзя', false, 'прошло');
  exception when others then
    perform pg_temp.check('удалённое переслать нельзя', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.forward_messages(chat_ab, array[album, gone]);
    perform pg_temp.check('пачка с удалённым отвергается целиком', false, 'прошло');
  exception when others then
    perform pg_temp.check('пачка с удалённым отвергается целиком', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as_anon();
  begin
    perform public.forward_messages(chat_ab, array[album]);
    perform pg_temp.check('anon не вызывает forward_messages', false, 'прошло');
  exception when others then
    perform pg_temp.check('anon не вызывает forward_messages', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- ================================================= подделка атрибуции
  perform pg_temp.act_as(b);

  -- Своё сообщение, выданное за пересланное от A с выдуманным текстом.
  reply := pg_temp.say(chat_ab, b, 'выдуманные слова A', now());
  begin
    insert into public.message_forwards (message_id, origin_message_id, origin_author_id)
    values (reply, album, a);
    perform pg_temp.check('подделка: прямая вставка «переслано от» отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('подделка: прямая вставка «переслано от» отвергается', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Только автор без ссылки на сообщение.
  begin
    insert into public.message_forwards (message_id, origin_author_id) values (reply, a);
    perform pg_temp.check('подделка: «переслано от» без оригинала отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('подделка: «переслано от» без оригинала отвергается', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Настоящую пересылку не переписать на другого автора или оригинал.
  select array_agg(id) into second_copies
  from public.forward_messages(chat_ab, array[album]) as f(id);

  begin
    update public.message_forwards set origin_author_id = c where message_id = second_copies[1];
    get diagnostics n = row_count;
    perform pg_temp.check('подделка: автора оригинала не переписать', n = 0, n::text);
  exception when others then
    perform pg_temp.check('подделка: автора оригинала не переписать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Текст пересланного не поменять: «Переслано от A» над чужими словами.
  begin
    update public.messages set text = 'выдуманные слова A' where id = second_copies[1];
    get diagnostics n = row_count;
    perform pg_temp.check('подделка: текст пересланного не поменять', n = 0, n::text || ' строк изменено');
  exception when others then
    perform pg_temp.check('подделка: текст пересланного не поменять', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  select text into s from public.messages where id = second_copies[1];
  perform pg_temp.check('текст пересланного совпадает с оригиналом', s = 'подпись альбома', s);

  -- И файлы к нему не дописать.
  begin
    insert into public.attachments (message_id, message_kind, url, mime_type, position)
    values (second_copies[1], 'media', 'https://x/fake.jpg', 'image/jpeg', 10);
    perform pg_temp.check('подделка: файл к пересланному не дописать', false, 'прошло');
  exception when others then
    perform pg_temp.check('подделка: файл к пересланному не дописать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    delete from public.message_forwards where message_id = second_copies[1];
    get diagnostics n = row_count;
    perform pg_temp.check('пометку пересылки не снять', n = 0, n::text);
  exception when others then
    perform pg_temp.check('пометку пересылки не снять', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Обычное своё сообщение правится только функцией правки: прямой UPDATE
  -- закрыт для всех (20260929180000_message_edit.sql).
  begin
    update public.messages set text = 'поправил' where id = reply;
    perform pg_temp.check('обычное своё сообщение прямым UPDATE не правится', false, 'прошло');
  exception when others then
    perform pg_temp.check('обычное своё сообщение прямым UPDATE не правится', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform public.edit_message(reply, 'поправил');
  select text into s from public.messages where id = reply;
  perform pg_temp.check('обычное своё сообщение правится функцией', s = 'поправил', s);
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
