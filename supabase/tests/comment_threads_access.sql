-- Треды комментариев, ранг и пересылка комментариев: кто может, что держит
-- схема, что нельзя подделать.
--
-- Запуск против облачной базы, ничего не оставляет — всё в транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/comment_threads_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- Транзакция одна, поэтому `now()` у всех комментариев одинаков: порядок по
-- рангу здесь решает только вовлечённость. Форму сообщения проверяет
-- отложенный триггер — после вставок он запускается принудительно.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a9', 'ta@test.local', '{"full_name":"Участник A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b9', 'tb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d9', 'td@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

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

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a9';
  b uuid := '00000000-0000-4000-8000-0000000000b9';
  d uuid := '00000000-0000-4000-8000-0000000000d9';
  chat uuid;
  chat_d uuid;
  m uuid;
  root1 uuid;
  root2 uuid;
  root3 uuid;
  r1 uuid;
  r2 uuid;
  r3 uuid;
  fwd uuid[];
  s text;
  n int;
begin
  -- ------------------------------------------------------------- подготовка
  -- A и B — участники чата, D — посетитель; у D свой чат с A.
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b], null) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);

  perform pg_temp.act_as(a);
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, a, 'text', 'сообщение') returning id into m;
  root1 := public.send_comment(m, 'первый корень');
  root2 := public.send_comment(m, 'второй корень');

  perform pg_temp.act_as(d);
  chat_d := (public.create_chat(array[a], null) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(a);
  perform public.accept_chat_invite(chat_d);

  -- ================================================================== треды
  perform pg_temp.act_as(d);
  r1 := public.send_comment(m, 'посетитель отвечает корню', '[]'::jsonb, array[root1]);
  select thread_root_id::text into s from public.comments where id = r1;
  perform pg_temp.check('посетитель отвечает на комментарий — ответ в треде корня', s = root1::text, s);

  r2 := public.send_comment(m, 'ответ на ответ', '[]'::jsonb, array[r1]);
  select thread_root_id::text into s from public.comments where id = r2;
  perform pg_temp.check('ответ на ответ — в тот же тред, не под-тред', s = root1::text, s);

  r3 := public.send_comment(m, 'цитаты внутри треда', '[]'::jsonb, array[r2, root1, r1]);
  select string_agg(quoted_id::text, ',' order by position) into s
  from public.comment_replies where comment_id = r3;
  perform pg_temp.check(
    'внутри треда цитировать можно сколько угодно — по порядку',
    s = r2::text || ',' || root1::text || ',' || r1::text,
    s
  );

  begin
    perform public.send_comment(m, 'два треда сразу', '[]'::jsonb, array[r1, root2]);
    perform pg_temp.check('одним ответом два треда не процитировать', false, 'прошло');
  exception when others then
    perform pg_temp.check('одним ответом два треда не процитировать', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_comment(m, 'два корня сразу', '[]'::jsonb, array[root1, root2]);
    perform pg_temp.check('два корня одним ответом — тоже два треда', false, 'прошло');
  exception when others then
    perform pg_temp.check('два корня одним ответом — тоже два треда', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.comments (chat_id, message_id, author_id, kind, text, thread_root_id)
    values (chat, m, d, 'text', 'под-тред', r1);
    perform pg_temp.check('корень треда — только верхнеуровневый', false, 'прошло');
  exception when others then
    perform pg_temp.check('корень треда — только верхнеуровневый', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  -- Верхнеуровневый — без цитат: дописать цитату к своему свежему корню нельзя.
  root3 := public.send_comment(m, 'корень посетителя');
  begin
    insert into public.comment_replies (message_id, comment_id, quoted_id, position)
    values (m, root3, root1, 0);
    perform pg_temp.check('у верхнеуровневого комментария цитат нет', false, 'прошло');
  exception when others then
    perform pg_temp.check('у верхнеуровневого комментария цитат нет', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.as_service();
  select replies_count into n from public.comments where id = root1;
  perform pg_temp.check('число ответов у корня', n = 3, n::text);

  select comments_count into n from public.messages where id = m;
  perform pg_temp.check('счётчик сообщения считает и ответы в тредах', n = 6, n::text);

  select count(*) into n from realtime.messages
  where topic = 'comments:' || m::text and event = 'comment_added'
    and payload ->> 'thread_root_id' = root1::text;
  perform pg_temp.check('сигнал о новом ответе несёт тред', n = 3, n::text);

  -- =================================================================== ранг
  perform pg_temp.act_as(b);
  perform public.set_reaction('comment', root2, '🔥');

  perform pg_temp.act_as(d);
  select string_agg(id::text, ',' order by rank desc, id desc) into s
  from public.list_thread_roots(m);
  perform pg_temp.check(
    'верх по рангу: ответы весят больше реакции, реакция выше пустого',
    s = root1::text || ',' || root2::text || ',' || root3::text,
    s
  );

  select count(*) into n from public.list_thread_roots(m) where thread_root_id is not null;
  perform pg_temp.check('ответы в верх не попадают', n = 0, n::text);

  select string_agg(id::text, ',') into s
  from public.list_thread_roots(
    m,
    (select rank from public.comments where id = root1),
    root1,
    1
  );
  perform pg_temp.check('keyset: следующая страница после корня', s = root2::text, s);

  -- ======================================================= удалённый корень
  perform pg_temp.act_as(a);
  perform public.delete_comment(root1);

  perform pg_temp.act_as(d);
  select coalesce(text, '∅') || '|' || coalesce(author_id::text, '∅') || '|' || replies_count
  into s from public.list_thread_roots(m) where id = root1;
  perform pg_temp.check('удалённый корень с ответами — заглушка без автора и текста', s = '∅|∅|3', s);

  select count(*) into n from public.comments where thread_root_id = root1;
  perform pg_temp.check('ответы удалённого корня живы', n = 3, n::text);

  r1 := public.send_comment(m, 'тред продолжается', '[]'::jsonb, array[r2]);
  select thread_root_id::text into s from public.comments where id = r1;
  perform pg_temp.check('в тред удалённого корня отвечают через его ответы', s = root1::text, s);

  perform pg_temp.act_as(a);
  perform public.delete_comment(root2);
  perform pg_temp.act_as(d);
  select count(*) into n from public.list_thread_roots(m) where id = root2;
  perform pg_temp.check('удалённый корень без ответов не отдаётся', n = 0, n::text);

  -- =============================================================== пересылка
  perform pg_temp.act_as(d);
  begin
    perform public.forward_comments(chat, array[r2]);
    perform pg_temp.check('посетитель не пересылает в чат, где он не участник', false, 'прошло');
  exception when others then
    perform pg_temp.check('посетитель не пересылает в чат, где он не участник', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  fwd := public.forward_comments(chat_d, array[r3, r2, r3]);
  perform pg_temp.check('участник пересылает комментарии в свой чат — повтор отсечён', cardinality(fwd) = 2, cardinality(fwd)::text);

  set constraints all immediate;
  set constraints all deferred;

  perform pg_temp.as_service();
  select string_agg(forwarded_comment_id::text, ',' order by created_at) into s
  from public.messages where id = any (fwd);
  perform pg_temp.check('порядок пересланных — как в панели', s = r3::text || ',' || r2::text, s);

  select string_agg(kind || '|' || coalesce(text, '∅') || '|' || author_id::text, ',') into s
  from public.messages where id = fwd[1];
  perform pg_temp.check('пересланный — ссылка, без копии текста, от переславшего', s = 'comment_forward|∅|' || d::text, s);

  select last_message_text into s from public.chats where id = chat_d;
  perform pg_temp.check('превью в списке чатов — текст комментария', s = '💬 ответ на ответ', s);

  perform pg_temp.act_as(a);
  begin
    perform public.set_reaction('message', fwd[1], '🔥');
    perform pg_temp.check('реакция на пересланный — только оригиналу', false, 'прошло');
  exception when others then
    perform pg_temp.check('реакция на пересланный — только оригиналу', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_comment(fwd[1], 'комментарий к пересланному');
    perform pg_temp.check('пересланный комментарий не комментируют', false, 'прошло');
  exception when others then
    perform pg_temp.check('пересланный комментарий не комментируют', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.forward_messages(chat_d, chat_d, array[fwd[1]]);
    perform pg_temp.check('пересланный комментарий в островок не встаёт', false, 'прошло');
  exception when others then
    perform pg_temp.check('пересланный комментарий в островок не встаёт', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.messages (chat_id, author_id, kind) values (chat_d, a, 'comment_forward');
    set constraints all immediate;
    perform pg_temp.check('пересланный без ссылки на комментарий отвергнут', false, 'прошло');
  exception when others then
    perform pg_temp.check('пересланный без ссылки на комментарий отвергнут', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;
  set constraints all deferred;

  perform pg_temp.act_as(d);
  perform public.delete_comment(r3);
  begin
    perform public.forward_comments(chat_d, array[r3]);
    perform pg_temp.check('удалённый комментарий не переслать', false, 'прошло');
  exception when others then
    perform pg_temp.check('удалённый комментарий не переслать', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  select count(*) into n from public.messages m2
  join public.comments c on c.id = m2.forwarded_comment_id
  where m2.id = fwd[1];
  perform pg_temp.check('удалённый оригинал пересланному не отдаётся — заглушка', n = 0, n::text);

  -- ================================================================ без входа
  perform pg_temp.act_as_anon();
  begin
    perform public.forward_comments(chat_d, array[r2]);
    perform pg_temp.check('без входа не переслать', false, 'прошло');
  exception when others then
    perform pg_temp.check('без входа не переслать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.list_thread_roots(m);
    perform pg_temp.check('без входа верх не читается', false, 'прошло');
  exception when others then
    perform pg_temp.check('без входа верх не читается', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
