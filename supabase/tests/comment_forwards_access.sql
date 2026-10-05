-- Пересланные комментарии и служебные сообщения: прямой вставкой их не
-- создать, только функциями.
--
-- Запуск против облачной базы, ничего не оставляет — всё в транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/comment_forwards_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- Политика вставки проверяется до ограничений и триггеров, поэтому отказ —
-- 42501, а не нарушение формы или внешнего ключа: служебные колонки здесь
-- заполнены как попало, до них дело не доходит.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000aa', 'cfa@test.local', '{"full_name":"Участник A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000ab', 'cfb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000ad', 'cfd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

-- Прямая вставка от текущего пользователя; true — если база её отвергла
-- политикой (42501). Отложенная форма проверяется тут же, чтобы прошедшая
-- вставка не всплыла ошибкой в конце транзакции.
create function pg_temp.rejected(
  chat uuid, author uuid, k text, body text,
  fwd_comment uuid default null, src_chat uuid default null,
  stream uuid default null, event text default null, comments int default 0
) returns text
language plpgsql as $$
begin
  begin
    insert into public.messages (
      chat_id, author_id, kind, text, forwarded_comment_id, source_chat_id,
      stream_id, system_event, comments_count
    )
    values (chat, author, k, body, fwd_comment, src_chat, stream, event, comments);
    set constraints all immediate;
    set constraints all deferred;
    return 'прошло';
  exception when others then
    set constraints all deferred;
    return sqlstate || ' ' || sqlerrm;
  end;
end;
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000ab';
  d uuid := '00000000-0000-4000-8000-0000000000ad';
  chat uuid;
  chat_d uuid;
  m uuid;
  live uuid;
  gone uuid;
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

  perform pg_temp.act_as(d);
  live := public.send_comment(m, 'живой комментарий');
  gone := public.send_comment(m, 'будет удалён');
  perform public.delete_comment(gone);
  chat_d := (public.create_chat(array[a], null) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(a);
  perform public.accept_chat_invite(chat_d);

  -- =============================================== прямая вставка: отказы
  perform pg_temp.act_as(a);

  s := pg_temp.rejected(chat, a, 'comment_forward', null, live);
  perform pg_temp.check('участник: пересланный живой комментарий прямой вставкой', s like '42501%', s);

  s := pg_temp.rejected(chat, a, 'comment_forward', null, gone);
  perform pg_temp.check('участник: пересланный удалённый комментарий прямой вставкой', s like '42501%', s);

  s := pg_temp.rejected(chat, a, 'system', 'звонок начат');
  perform pg_temp.check('участник: системное сообщение', s like '42501%', s);

  s := pg_temp.rejected(chat, a, 'system', 'звонок начат', null, null, gen_random_uuid(), 'call_started');
  perform pg_temp.check('участник: системное о звонке со стримом и событием', s like '42501%', s);

  s := pg_temp.rejected(chat, a, 'text', 'текст', null, null, gen_random_uuid());
  perform pg_temp.check('участник: текст со stream_id', s like '42501%', s);

  s := pg_temp.rejected(chat, a, 'text', 'текст', null, null, null, 'call_ended');
  perform pg_temp.check('участник: текст с system_event', s like '42501%', s);

  s := pg_temp.rejected(chat, a, 'text', 'текст', null, chat_d);
  perform pg_temp.check('участник: текст с source_chat_id', s like '42501%', s);

  s := pg_temp.rejected(chat, a, 'text', 'текст', live);
  perform pg_temp.check('участник: текст с forwarded_comment_id', s like '42501%', s);

  s := pg_temp.rejected(chat, a, 'forward', null, null, chat_d);
  perform pg_temp.check('участник: островок прямой вставкой', s like '42501%', s);

  s := pg_temp.rejected(chat, a, 'text', 'накрутка', null, null, null, null, 1000);
  perform pg_temp.check('участник: текст с готовым счётчиком комментариев', s like '42501%', s);

  -- ================================== центральная политика не сломана
  s := pg_temp.rejected(chat, a, 'text', 'обычный текст');
  perform pg_temp.check('участник: обычный текст проходит', s = 'прошло', s);

  perform pg_temp.act_as(d);
  s := pg_temp.rejected(chat, d, 'text', 'посторонний пишет');
  perform pg_temp.check('посторонний: текст в чужой чат', s like '42501%', s);

  s := pg_temp.rejected(chat, d, 'comment_forward', null, live);
  perform pg_temp.check('посторонний: пересланный комментарий прямой вставкой', s like '42501%', s);

  -- ============================================ forward_comments
  perform pg_temp.act_as(a);
  fwd := public.forward_comments(chat, array[live]);
  set constraints all immediate;
  set constraints all deferred;

  select count(*) into n from public.messages
  where id = any (fwd) and kind = 'comment_forward' and forwarded_comment_id = live and author_id = a;
  perform pg_temp.check('участник: forward_comments создаёт пересланный', n = 1, n::text);

  begin
    perform public.forward_comments(chat, array[gone]);
    perform pg_temp.check('участник: удалённый комментарий не переслать', false, 'прошло');
  exception when others then
    perform pg_temp.check('участник: удалённый комментарий не переслать', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  -- D — участник своего чата с A, но не чата A и B.
  perform pg_temp.act_as(d);
  begin
    perform public.forward_comments(chat, array[live]);
    perform pg_temp.check('посторонний: forward_comments в чужой чат', false, 'прошло');
  exception when others then
    perform pg_temp.check('посторонний: forward_comments в чужой чат', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  fwd := public.forward_comments(chat_d, array[live]);
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.check('посетитель пересылает комментарий в свой чат', cardinality(fwd) = 1, cardinality(fwd)::text);
end;
$$;

select * from results order by n;

rollback;
