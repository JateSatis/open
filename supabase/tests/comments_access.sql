-- Комментарии: кто может писать, что закрыто, какие инварианты держит база,
-- верен ли счётчик и не смешиваются ли комментарии с перепиской.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/comments_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- Проверка формы комментария — отложенный триггер в конце транзакции.
-- Транзакция здесь одна на весь файл, поэтому там, где это важно, он
-- запускается принудительно: `set constraints all immediate`.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a6', 'ca@test.local', '{"full_name":"Участник A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b6', 'cb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d6', 'cd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

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

create function pg_temp.say(chat uuid, author uuid, body text) returns uuid
language plpgsql as $$
declare
  id uuid;
begin
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, author, 'text', body)
  returning messages.id into id;
  return id;
end;
$$;

-- Счётчик на сообщении и число живых комментариев в таблице — «счётчик / пересчёт».
create function pg_temp.counts(msg uuid) returns text language sql as $$
  select
    (select comments_count from public.messages where id = msg)::text
    || ' / ' ||
    (select count(*) from public.comments where message_id = msg and deleted_at is null)::text
$$;

-- Сколько событий с этим именем легло в топик.
create function pg_temp.events(topic_name text, event_name text) returns int language sql as $$
  select count(*)::int from realtime.messages where topic = topic_name and event = event_name
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a6';
  b uuid := '00000000-0000-4000-8000-0000000000b6';
  d uuid := '00000000-0000-4000-8000-0000000000d6';
  chat uuid;
  chat_other uuid;
  ma uuid;
  mb uuid;
  gone uuid;
  sys uuid;
  foreign_msg uuid;
  cd uuid;
  cd_media uuid;
  cd_voice uuid;
  cb uuid;
  row_id uuid;
  n int;
  n2 int;
  s text;
  ts timestamptz;
  preview_before text;
  s2 text;
  new_message_before int;
  personal_before int;
begin
  -- ------------------------------------------------------------- подготовка
  -- A звал B, B принял. D в чат не звали — он посетитель.
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b], null) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);

  perform pg_temp.act_as(a);
  ma := pg_temp.say(chat, a, 'от A');
  gone := pg_temp.say(chat, a, 'будет удалено');
  perform pg_temp.act_as(b);
  mb := pg_temp.say(chat, b, 'от B');
  perform pg_temp.act_as(a);
  perform public.delete_messages(array[gone]);

  -- Другой чат — для подделки чата комментария.
  perform pg_temp.act_as(d);
  chat_other := (public.create_chat(array[a], null) ->> 'chat_id')::uuid;
  foreign_msg := pg_temp.say(chat_other, d, 'в другом чате');

  perform pg_temp.as_service();
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, null, 'system', 'служебное')
  returning id into sys;

  -- Рассылка нового сообщения отложена до конца транзакции — запускаем её
  -- сейчас, чтобы точка отсчёта включала всё, что прислали сами сообщения.
  set constraints all immediate;
  set constraints all deferred;

  select last_message_text into preview_before from public.chats where id = chat;
  new_message_before := pg_temp.events('chat:' || chat::text, 'new_message');
  select count(*) into personal_before from realtime.messages
  where topic like 'user:%' and payload ->> 'chat_id' = chat::text;

  -- ============================== посетитель комментирует в чужом чате
  perform pg_temp.act_as(d);
  cd := public.send_comment(ma, '  первый комментарий  ');
  select audience, text into s, s2 from public.comments where id = cd;
  perform pg_temp.check('посетитель оставляет текстовый комментарий в чужом чате', s = 'visitor', s);
  perform pg_temp.check('текст обрезан по краям', s2 = 'первый комментарий', s2);

  cd_media := public.send_comment(
    ma,
    'альбом',
    '[{"url":"https://x/1.jpg","mime_type":"image/jpeg","width":100,"height":80},
      {"url":"https://x/2.mp4","poster_url":"https://x/2p.jpg","mime_type":"video/mp4","width":640,"height":360,"duration_ms":5000}]'::jsonb
  );
  select string_agg(comment_kind || ':' || url, ',' order by position) into s
  from public.comment_attachments where comment_id = cd_media;
  perform pg_temp.check(
    'посетитель оставляет комментарий с медиа',
    s = 'media:https://x/1.jpg,media:https://x/2.mp4',
    s
  );

  cd_voice := public.send_voice_comment(
    ma,
    '{"url":"https://x/v.m4a","mime_type":"audio/mp4","duration_ms":4200,"size_bytes":1000,"waveform":[1,5,31]}'::jsonb
  );
  select kind || '|' || (select duration_ms || '|' || waveform::text from public.comment_attachments where comment_id = cd_voice)
  into s from public.comments where id = cd_voice;
  perform pg_temp.check('посетитель оставляет голосовой комментарий', s = 'voice|4200|{1,5,31}', s);

  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.check('форма всех трёх видов проходит проверку', true);

  -- ================================================== участник тоже может
  perform pg_temp.act_as(b);
  cb := public.send_comment(ma, 'от участника');
  select audience into s from public.comments where id = cb;
  perform pg_temp.check('участник комментирует — ряд «участник»', s = 'member', s);

  -- ============================================= подделки при вставке
  perform pg_temp.act_as(d);

  begin
    insert into public.comments (chat_id, message_id, author_id, kind, text)
    values (chat, ma, a, 'text', 'от имени A');
    perform pg_temp.check('автора не подделать', false, 'прошло');
  exception when others then
    perform pg_temp.check('автора не подделать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.comments (chat_id, message_id, author_id, kind, text)
    values (chat_other, ma, d, 'text', 'не тот чат');
    perform pg_temp.check('чат комментария обязан совпадать с чатом сообщения', false, 'прошло');
  exception when others then
    perform pg_temp.check('чат комментария обязан совпадать с чатом сообщения', sqlstate = '23503', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.comments (chat_id, message_id, author_id, kind, text, created_at)
    values (chat, ma, d, 'text', 'из прошлого', now() - interval '1 day');
    perform pg_temp.check('время не подделать', false, 'прошло');
  exception when others then
    perform pg_temp.check('время не подделать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.comments (chat_id, message_id, author_id, kind, text, audience)
    values (chat, ma, d, 'text', 'я участник', 'member');
    perform pg_temp.check('ряд не подделать', false, 'прошло');
  exception when others then
    perform pg_temp.check('ряд не подделать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Прямая вставка по правилам разрешена, время ставит сервер.
  insert into public.comments (chat_id, message_id, author_id, kind, text)
  values (chat, mb, d, 'text', 'прямой вставкой')
  returning id, created_at into row_id, ts;
  perform pg_temp.check('прямая вставка от своего имени проходит, время — серверное', ts = now(), ts::text);

  -- ================================== к чему комментарий оставить нельзя
  begin
    perform public.send_comment(gone, 'к удалённому');
    perform pg_temp.check('к удалённому сообщению не прокомментировать', false, 'прошло');
  exception when others then
    perform pg_temp.check('к удалённому сообщению не прокомментировать', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.comments (chat_id, message_id, author_id, kind, text)
    values (chat, gone, d, 'text', 'к удалённому напрямую');
    perform pg_temp.check('к удалённому и прямой вставкой нельзя', false, 'прошло');
  exception when others then
    perform pg_temp.check('к удалённому и прямой вставкой нельзя', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_comment(sys, 'к системному');
    perform pg_temp.check('к системному сообщению не прокомментировать', false, 'прошло');
  exception when others then
    perform pg_temp.check('к системному сообщению не прокомментировать', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_comment(gen_random_uuid(), 'в пустоту');
    perform pg_temp.check('к несуществующему сообщению не прокомментировать', false, 'прошло');
  exception when others then
    perform pg_temp.check('к несуществующему сообщению не прокомментировать', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_voice_comment(gone, '{"url":"https://x/v.m4a","mime_type":"audio/mp4","duration_ms":1000}'::jsonb);
    perform pg_temp.check('голосовое к удалённому не принять', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое к удалённому не принять', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  -- ===================================================== инварианты вложений
  begin
    perform public.send_voice_comment(ma, '{"url":"https://x/v.m4a","mime_type":"audio/mp4"}'::jsonb);
    perform pg_temp.check('голосовое без длительности отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое без длительности отвергается', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_voice_comment(ma, '{"url":"https://x/v.jpg","mime_type":"image/jpeg","duration_ms":1000}'::jsonb);
    perform pg_temp.check('голосовое не из звука отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое не из звука отвергается', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.comments (chat_id, message_id, author_id, kind)
    values (chat, ma, d, 'voice')
    returning id into row_id;
    insert into public.comment_attachments (comment_id, comment_kind, url, mime_type, duration_ms, position)
    values (row_id, 'voice', 'https://x/1.m4a', 'audio/mp4', 1000, 0);
    insert into public.comment_attachments (comment_id, comment_kind, url, mime_type, duration_ms, position)
    values (row_id, 'voice', 'https://x/2.m4a', 'audio/mp4', 1000, 1);
    perform pg_temp.check('голосовое с двумя файлами отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое с двумя файлами отвергается', sqlstate = '23505', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.comments (chat_id, message_id, author_id, kind)
    values (chat, ma, d, 'voice');
    set constraints all immediate;
    perform pg_temp.check('голосовое без файла отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое без файла отвергается', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;
  set constraints all deferred;

  begin
    perform public.send_comment(ma, '   ');
    set constraints all immediate;
    perform pg_temp.check('пустой комментарий отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('пустой комментарий отвергается', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;
  set constraints all deferred;

  begin
    perform public.send_comment(ma, null, '[{"url":"https://x/a.m4a","mime_type":"audio/mp4","duration_ms":1000}]'::jsonb);
    perform pg_temp.check('звук в альбоме отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('звук в альбоме отвергается', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.comment_attachments (comment_id, comment_kind, url, mime_type, position)
    values (cd, 'text', 'https://x/late.jpg', 'image/jpeg', 0);
    set constraints all immediate;
    perform pg_temp.check('к текстовому комментарию файл не дописать', false, 'прошло');
  exception when others then
    perform pg_temp.check('к текстовому комментарию файл не дописать', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;
  set constraints all deferred;

  -- Файлы к старому комментарию — только в транзакции отправки.
  perform pg_temp.as_service();
  update public.comments set created_at = now() - interval '1 hour' where id = cd_media;
  perform pg_temp.act_as(d);

  begin
    insert into public.comment_attachments (comment_id, comment_kind, url, mime_type, position)
    values (cd_media, 'media', 'https://x/late.jpg', 'image/jpeg', 5);
    perform pg_temp.check('к старому альбому файл напрямую не дописать', false, 'прошло');
  exception when others then
    perform pg_temp.check('к старому альбому файл напрямую не дописать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- ============================================= чужое не тронуть
  perform pg_temp.act_as(d);

  begin
    perform public.delete_comment(cb);
    perform pg_temp.check('чужой комментарий не удалить функцией', false, 'прошло');
  exception when others then
    perform pg_temp.check('чужой комментарий не удалить функцией', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.edit_comment(cb, 'D правит B');
    perform pg_temp.check('чужой комментарий не изменить функцией', false, 'прошло');
  exception when others then
    perform pg_temp.check('чужой комментарий не изменить функцией', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.comments set text = 'тихая подмена' where id = cb;
    perform pg_temp.check('чужой комментарий не изменить прямым UPDATE', false, 'прошло');
  exception when others then
    perform pg_temp.check('чужой комментарий не изменить прямым UPDATE', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    delete from public.comments where id = cb;
    perform pg_temp.check('чужой комментарий не удалить прямым DELETE', false, 'прошло');
  exception when others then
    perform pg_temp.check('чужой комментарий не удалить прямым DELETE', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.comments set text = 'своё, но напрямую' where id = cd;
    perform pg_temp.check('и свой комментарий напрямую не изменить', false, 'прошло');
  exception when others then
    perform pg_temp.check('и свой комментарий напрямую не изменить', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    delete from public.comment_attachments where comment_id = cd_media;
    perform pg_temp.check('вложение напрямую не удалить', false, 'прошло');
  exception when others then
    perform pg_temp.check('вложение напрямую не удалить', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(b);
  select text into s from public.comments where id = cb;
  perform pg_temp.check('комментарий B после попыток прежний', s = 'от участника', s);

  -- =========================================================== правка
  perform pg_temp.act_as(d);
  perform public.edit_comment(cd, 'исправленный');
  select text, edited_at into s, ts from public.comments where id = cd;
  perform pg_temp.check('автор правит свой комментарий', s = 'исправленный', s);
  perform pg_temp.check('время правки ставит сервер', ts = now(), ts::text);

  perform public.edit_comment(cd, 'исправленный');

  begin
    select count(*) into n from public.comment_revisions;
    perform pg_temp.check('автор не читает ревизии', false, n::text);
  exception when others then
    perform pg_temp.check('автор не читает ревизии', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.as_service();
  select count(*), string_agg(kind || '|' || coalesce(text, ''), ';') into n, s
  from public.comment_revisions where comment_id = cd;
  perform pg_temp.check('ревизия хранит прежнюю версию, повтор не плодит новых', n = 1 and s = 'text|первый комментарий', n || ' ' || s);
  perform pg_temp.act_as(d);

  -- Альбом → голосовое: вид и вложения меняются целиком.
  perform public.edit_comment(
    cd_media,
    '',
    '[]'::jsonb,
    '{"url":"https://x/new.m4a","mime_type":"audio/mp4","duration_ms":900}'::jsonb
  );
  set constraints all immediate;
  set constraints all deferred;
  select c.kind || '|' || coalesce(c.text, '') || '|' || string_agg(a.comment_kind || ':' || a.url, ',')
  into s
  from public.comments c join public.comment_attachments a on a.comment_id = c.id
  where c.id = cd_media
  group by c.kind, c.text;
  perform pg_temp.check('правка меняет альбом на голосовое', s = 'voice||voice:https://x/new.m4a', s);

  begin
    perform public.edit_comment(cd, '');
    perform pg_temp.check('пустую правку не сохранить', false, 'прошло');
  exception when others then
    perform pg_temp.check('пустую правку не сохранить', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  -- ============================================ не смешиваются с перепиской
  perform pg_temp.act_as(d);
  select count(*) into n from public.messages where chat_id = chat;
  perform pg_temp.check('комментарии не попадают в выборку сообщений чата', n = 3, n::text);

  perform pg_temp.as_service();
  select last_message_text into s from public.chats where id = chat;
  perform pg_temp.check('превью чата не тронуто комментариями', s = preview_before, coalesce(s, 'null') || ' / ' || coalesce(preview_before, 'null'));
  n := pg_temp.events('chat:' || chat::text, 'new_message');
  perform pg_temp.check('комментарии не шлют new_message в чат', n = new_message_before, n || ' / ' || new_message_before);
  select count(*) into n from realtime.messages
  where topic like 'user:%' and payload ->> 'chat_id' = chat::text;
  perform pg_temp.check('комментарии не шлют личных событий о чате', n = personal_before, n || ' / ' || personal_before);

  -- ================================================================ события
  n := pg_temp.events('comments:' || ma::text, 'comment_added');
  perform pg_temp.check('новые комментарии — событием в топик комментариев', n = 4, n::text);
  n := pg_temp.events('comments:' || ma::text, 'comment_edited');
  perform pg_temp.check('правка — событием в топик комментариев', n = 2, n::text);
  n := pg_temp.events('chat:' || chat::text, 'comments_changed');
  perform pg_temp.check('изменение счётчика — событием в топик чата', n = 5, n::text);

  -- ============================================================ счётчик
  s := pg_temp.counts(ma);
  perform pg_temp.check('счётчик после добавления', s = '4 / 4', s);

  perform pg_temp.act_as(d);
  perform public.delete_comment(cd);
  perform public.delete_comment(cd);
  select count(*) into n from public.comments where id = cd;
  perform pg_temp.check('удалённый комментарий не виден', n = 0, n::text);

  perform pg_temp.as_service();
  s := pg_temp.counts(ma);
  perform pg_temp.check('счётчик после удаления (повтор не считается)', s = '3 / 3', s);
  select deleted_at into ts from public.comments where id = cd;
  perform pg_temp.check('удаление мягкое — строка на месте', ts is not null, ts::text);
  n := pg_temp.events('comments:' || ma::text, 'comment_deleted');
  perform pg_temp.check('удаление — событием в топик комментариев', n = 1, n::text);

  perform pg_temp.act_as(d);

  begin
    perform public.edit_comment(cd, 'воскрешение');
    perform pg_temp.check('удалённый комментарий не изменить', false, 'прошло');
  exception when others then
    perform pg_temp.check('удалённый комментарий не изменить', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  -- ============================== удалённое сообщение: старые видны, новых нет
  perform pg_temp.act_as(a);
  perform public.delete_messages(array[ma]);
  -- Realtime-таблицу считает сервисная роль: у пользователя её режет RLS по топику.
  perform pg_temp.as_service();
  n := pg_temp.events('comments:' || ma::text, 'target_changed');
  perform pg_temp.check('удаление сообщения — сигналом открытой панели', n = 1, n::text);

  perform pg_temp.act_as(d);
  select count(*) into n from public.comments where message_id = ma;
  perform pg_temp.check('комментарии удалённого сообщения по-прежнему видны', n = 3, n::text);

  begin
    perform public.send_comment(ma, 'после удаления');
    perform pg_temp.check('к удалённому по ходу сообщению новые не принимаются', false, 'прошло');
  exception when others then
    perform pg_temp.check('к удалённому по ходу сообщению новые не принимаются', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(b);

  begin
    perform public.edit_comment(cb, 'правка под удалённым');
    perform pg_temp.check('правка комментария к удалённому сообщению не принимается', false, 'прошло');
  exception when others then
    perform pg_temp.check('правка комментария к удалённому сообщению не принимается', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  perform public.delete_comment(cb);
  perform pg_temp.check('свой комментарий к удалённому сообщению удалить можно', true);

  -- ================================================================ правка сообщения
  perform pg_temp.act_as(b);
  perform public.edit_message(mb, 'от B, поправлено');
  perform pg_temp.as_service();
  n := pg_temp.events('comments:' || mb::text, 'target_changed');
  perform pg_temp.check('правка сообщения — сигналом открытой панели', n = 1, n::text);

  -- ============================================================ Realtime
  perform pg_temp.act_as(d);
  perform set_config('realtime.topic', 'comments:' || ma::text, true);
  select count(*) into n from realtime.messages where topic = 'comments:' || ma::text;
  perform pg_temp.check('топик комментариев читает посетитель', n > 0, n::text);

  perform set_config('realtime.topic', 'user:' || a::text, true);
  select count(*) into n from realtime.messages where topic = 'user:' || a::text;
  perform pg_temp.check('чужой личный топик по-прежнему закрыт', n = 0, n::text);

  -- ================================================================ без входа
  perform pg_temp.act_as_anon();

  begin
    perform public.send_comment(mb, 'аноним');
    perform pg_temp.check('без входа комментарий не оставить', false, 'прошло');
  exception when others then
    perform pg_temp.check('без входа комментарий не оставить', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    select count(*) into n from public.comments;
    perform pg_temp.check('без входа комментарии не читаются', n = 0, n::text);
  exception when others then
    perform pg_temp.check('без входа комментарии не читаются', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- ================================================================ сверка
  perform pg_temp.as_service();
  s := pg_temp.counts(mb);
  perform pg_temp.check('счётчик B сходится с таблицей', s = '1 / 1', s);
  select count(*) into n from public.messages where id = foreign_msg and comments_count = 0;
  perform pg_temp.check('чужие сообщения счётчик не задело', n = 1, n::text);
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
