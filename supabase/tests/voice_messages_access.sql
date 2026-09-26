-- Голосовые сообщения: кто может отправить и какие голосовые база отвергает.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/voice_messages_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- «Ровно одно вложение» проверяет отложенный триггер в конце транзакции.
-- Здесь транзакция одна на весь файл, поэтому после каждой попытки проверки
-- принудительно запускаются `set constraints all immediate`, а потом
-- возвращаются в отложенный режим.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated;
grant all on results_n_seq to authenticated;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'va@test.local', '{"full_name":"Голос A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b1', 'vb@test.local', '{"full_name":"Голос B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d1', 'vd@test.local', '{"full_name":"Посторонний D"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

create function pg_temp.voice(
  duration_ms int default 12000,
  mime text default 'audio/mp4',
  waveform jsonb default '[0, 5, 31, 12]'
) returns jsonb language sql as $$
  select jsonb_build_object(
    'url', 'https://cdn.test/voice.m4a',
    'mime_type', mime,
    'duration_ms', duration_ms,
    'size_bytes', 9000,
    'waveform', waveform
  )
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b1';
  d uuid := '00000000-0000-4000-8000-0000000000d1';
  chat_ab uuid;
  msg uuid;
  n int;
  s text;
  bars smallint[];
begin
  perform pg_temp.act_as(a);
  chat_ab := (public.create_chat(array[b], null) ->> 'chat_id')::uuid;

  -- ------------------------------------------------------------ разрешённое
  msg := public.send_voice_message(chat_ab, pg_temp.voice());
  set constraints all immediate;
  set constraints all deferred;

  select count(*) into n from public.attachments where message_id = msg;
  perform pg_temp.check('участник отправляет голосовое', n = 1);

  select kind into s from public.messages where id = msg;
  perform pg_temp.check('вид сообщения — voice', s = 'voice', s);

  select waveform into bars from public.attachments where message_id = msg;
  perform pg_temp.check('волна сохранена по порядку', bars = array[0, 5, 31, 12]::smallint[], bars::text);

  select last_message_text into s from public.chats where id = chat_ab;
  perform pg_temp.check('превью с длительностью', s = '🎤 Голосовое сообщение (0:12)', s);

  msg := public.send_voice_message(chat_ab, pg_temp.voice(duration_ms => 800, waveform => 'null'));
  set constraints all immediate;
  set constraints all deferred;
  select waveform into bars from public.attachments where message_id = msg;
  perform pg_temp.check('голосовое без волны допустимо', bars is null);
  select last_message_text into s from public.chats where id = chat_ab;
  perform pg_temp.check('короче секунды — «0:01», не «0:00»', s = '🎤 Голосовое сообщение (0:01)', s);

  msg := public.send_voice_message(chat_ab, pg_temp.voice(duration_ms => 125000));
  set constraints all immediate;
  set constraints all deferred;
  select last_message_text into s from public.chats where id = chat_ab;
  perform pg_temp.check('превью минут', s = '🎤 Голосовое сообщение (2:05)', s);

  -- ----------------------------------------------------------- посторонний
  perform pg_temp.act_as(d);

  select count(*) into n from public.attachments where message_id = msg;
  perform pg_temp.check('посторонний видит голосовое', n = 1);

  begin
    perform public.send_voice_message(chat_ab, pg_temp.voice());
    set constraints all immediate;
    perform pg_temp.check('посторонний не отправляет голосовое функцией', false, 'прошло');
  exception when others then
    perform pg_temp.check('посторонний не отправляет голосовое функцией', true, sqlerrm);
  end;
  set constraints all deferred;

  begin
    insert into public.messages (chat_id, author_id, kind) values (chat_ab, d, 'voice');
    set constraints all immediate;
    perform pg_temp.check('посторонний не вставляет голосовое напрямую', false, 'прошло');
  exception when others then
    perform pg_temp.check('посторонний не вставляет голосовое напрямую', true, sqlerrm);
  end;
  set constraints all deferred;

  begin
    insert into public.attachments (message_id, message_kind, url, mime_type, duration_ms, position)
    values (msg, 'voice', 'https://cdn.test/x.m4a', 'audio/mp4', 1000, 1);
    perform pg_temp.check('посторонний не добавляет вложение к чужому голосовому', false, 'прошло');
  exception when others then
    perform pg_temp.check('посторонний не добавляет вложение к чужому голосовому', true, sqlerrm);
  end;

  -- --------------------------------------------------------- инварианты
  perform pg_temp.act_as(a);

  begin
    insert into public.messages (chat_id, author_id, kind) values (chat_ab, a, 'voice');
    set constraints all immediate;
    perform pg_temp.check('голосовое без вложения отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое без вложения отвергается', true, sqlerrm);
  end;
  set constraints all deferred;

  begin
    insert into public.attachments (message_id, message_kind, url, mime_type, duration_ms, position)
    values (msg, 'voice', 'https://cdn.test/second.m4a', 'audio/mp4', 1000, 1);
    perform pg_temp.check('второе вложение голосового отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('второе вложение голосового отвергается', true, sqlerrm);
  end;

  begin
    insert into public.messages (id, chat_id, author_id, kind)
    values ('00000000-0000-4000-8000-0000000000f1', chat_ab, a, 'voice');
    insert into public.attachments (message_id, message_kind, url, mime_type, duration_ms, position)
    values ('00000000-0000-4000-8000-0000000000f1', 'voice', 'https://cdn.test/1.m4a', 'audio/mp4', 1000, 0),
           ('00000000-0000-4000-8000-0000000000f1', 'voice', 'https://cdn.test/2.m4a', 'audio/mp4', 1000, 1);
    set constraints all immediate;
    perform pg_temp.check('голосовое с двумя вложениями отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое с двумя вложениями отвергается', true, sqlerrm);
  end;
  set constraints all deferred;

  begin
    perform public.send_voice_message(chat_ab, pg_temp.voice(mime => 'video/mp4'));
    set constraints all immediate;
    perform pg_temp.check('не-аудио файл отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('не-аудио файл отвергается', true, sqlerrm);
  end;
  set constraints all deferred;

  begin
    perform public.send_voice_message(chat_ab, pg_temp.voice(mime => null));
    set constraints all immediate;
    perform pg_temp.check('голосовое без mime отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое без mime отвергается', true, sqlerrm);
  end;
  set constraints all deferred;

  begin
    perform public.send_voice_message(chat_ab, pg_temp.voice(duration_ms => null));
    set constraints all immediate;
    perform pg_temp.check('голосовое без длительности отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое без длительности отвергается', true, sqlerrm);
  end;
  set constraints all deferred;

  begin
    perform public.send_voice_message(chat_ab, pg_temp.voice(duration_ms => 0));
    set constraints all immediate;
    perform pg_temp.check('голосовое нулевой длины отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое нулевой длины отвергается', true, sqlerrm);
  end;
  set constraints all deferred;

  begin
    perform public.send_voice_message(chat_ab, pg_temp.voice(waveform => '[1, 40]'));
    set constraints all immediate;
    perform pg_temp.check('столбик волны больше 31 отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('столбик волны больше 31 отвергается', true, sqlerrm);
  end;
  set constraints all deferred;

  begin
    perform public.send_voice_message(
      chat_ab,
      pg_temp.voice(waveform => (select jsonb_agg(1) from generate_series(1, 65)))
    );
    set constraints all immediate;
    perform pg_temp.check('волна длиннее 64 столбиков отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('волна длиннее 64 столбиков отвергается', true, sqlerrm);
  end;
  set constraints all deferred;

  begin
    perform public.send_voice_message(chat_ab, null);
    set constraints all immediate;
    perform pg_temp.check('пустой voice отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('пустой voice отвергается', true, sqlerrm);
  end;
  set constraints all deferred;

  -- Альбомы и текст по-прежнему работают после переезда рассылки в конец транзакции.
  msg := public.send_media_message(chat_ab, 'подпись', jsonb_build_array(
    jsonb_build_object('url', 'https://cdn.test/p.jpg', 'mime_type', 'image/jpeg', 'width', 10, 'height', 10)
  ));
  set constraints all immediate;
  set constraints all deferred;
  select last_message_text into s from public.chats where id = chat_ab;
  perform pg_temp.check('альбом с подписью: превью — подпись', s = 'подпись', s);

  begin
    msg := public.send_media_message(chat_ab, 'просто текст', null);
    set constraints all immediate;
    set constraints all deferred;
    select last_message_text into s from public.chats where id = chat_ab;
    perform pg_temp.check('текст: превью — текст', s = 'просто текст', s);
  exception when others then
    perform pg_temp.check('текст: превью — текст', false, sqlerrm);
  end;
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
