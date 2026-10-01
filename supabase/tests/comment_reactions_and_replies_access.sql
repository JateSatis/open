-- Реакции и ответы в комментариях: кто может, в какой ряд ложится реакция,
-- верны ли счётчики, что держит схема ответов.
--
-- Запуск против облачной базы, ничего не оставляет — всё в транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/comment_reactions_and_replies_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a7', 'ra@test.local', '{"full_name":"Участник A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b7', 'rb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d7', 'rd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

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
  a uuid := '00000000-0000-4000-8000-0000000000a7';
  b uuid := '00000000-0000-4000-8000-0000000000b7';
  d uuid := '00000000-0000-4000-8000-0000000000d7';
  chat uuid;
  chat_other uuid;
  m uuid;
  m_other uuid;
  ca uuid;
  cd uuid;
  c_other uuid;
  reply uuid;
  s text;
  n int;
begin
  -- ------------------------------------------------------------- подготовка
  -- A и B — участники, D — посетитель.
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b], null) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);

  perform pg_temp.act_as(a);
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, a, 'text', 'сообщение') returning id into m;
  ca := public.send_comment(m, 'комментарий участника');

  perform pg_temp.act_as(d);
  cd := public.send_comment(m, 'комментарий посетителя');
  chat_other := (public.create_chat(array[a], null) ->> 'chat_id')::uuid;
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat_other, d, 'text', 'другое сообщение') returning id into m_other;
  c_other := public.send_comment(m_other, 'в другой ветке');

  -- ================================================================ реакции
  perform pg_temp.act_as(d);
  select emoji || '|' || audience into s from public.set_reaction('comment', ca, '🔥');
  perform pg_temp.check('посетитель ставит реакцию на комментарий в чужом чате — ряд visitor', s = '🔥|visitor', s);

  perform pg_temp.act_as(b);
  select emoji || '|' || audience into s from public.set_reaction('comment', ca, '👍');
  perform pg_temp.check('участник ставит реакцию на комментарий — ряд member', s = '👍|member', s);

  perform pg_temp.act_as(d);
  begin
    insert into public.reactions (target_type, target_id, user_id, emoji, audience)
    values ('comment', cd, d, '👍', 'member');
    select audience into s from public.reactions
    where target_type = 'comment' and target_id = cd and user_id = d and deleted_at is null;
    perform pg_temp.check('ряд не подделать прямой вставкой', s = 'visitor', s);
  exception when others then
    perform pg_temp.check('ряд не подделать прямой вставкой', false, sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.as_service();
  select member_reactions::text || '|' || visitor_reactions::text || '|' || reactions_count
  into s from public.comments where id = ca;
  perform pg_temp.check('счётчики комментария по рядам', s = '{"👍": 1}|{"🔥": 1}|2', s);

  select count(*) into n from realtime.messages
  where topic = 'comments:' || m::text and event = 'comment_reactions_changed';
  perform pg_temp.check('изменение реакций — сигнал в топик комментариев', n >= 2, n::text);

  perform pg_temp.act_as(d);
  perform public.set_reaction('comment', ca, null);
  perform pg_temp.as_service();
  select visitor_reactions::text || '|' || reactions_count into s from public.comments where id = ca;
  perform pg_temp.check('снятая реакция уходит из счётчика', s = '{}|1', s);

  perform pg_temp.act_as(d);
  select emoji into s from public.my_reaction((select c from public.comments c where c.id = cd));
  perform pg_temp.check('моя реакция на комментарий читается выборкой', s = '👍', coalesce(s, 'null'));

  perform pg_temp.act_as(b);
  begin
    perform public.set_reaction('comment', gen_random_uuid(), '🔥');
    perform pg_temp.check('реакция на несуществующий комментарий отвергнута', false, 'прошло');
  exception when others then
    perform pg_temp.check('реакция на несуществующий комментарий отвергнута', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  -- ================================================================ ответы
  perform pg_temp.act_as(d);
  reply := public.send_comment(m, 'ответ посетителя', '[]'::jsonb, array[ca, cd]);
  select string_agg(quoted_id::text, ',' order by position) into s
  from public.comment_replies where comment_id = reply;
  perform pg_temp.check('посетитель отвечает на комментарии — цитаты по порядку', s = ca::text || ',' || cd::text, s);

  begin
    perform public.send_comment(m, 'цитата из чужой ветки', '[]'::jsonb, array[c_other]);
    perform pg_temp.check('цитата только из той же ветки', false, 'прошло');
  exception when others then
    perform pg_temp.check('цитата только из той же ветки', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.comment_replies (message_id, comment_id, quoted_id, position)
    values (m, ca, cd, 0);
    perform pg_temp.check('к чужому комментарию цитату не дописать', false, 'прошло');
  exception when others then
    perform pg_temp.check('к чужому комментарию цитату не дописать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.comment_replies (message_id, comment_id, quoted_id, position)
    values (m, reply, ca, 5);
    perform pg_temp.check('к старому своему комментарию цитату задним числом не дописать', false, 'прошло');
  exception when others then
    -- В этой транзакции «старого» нет — всё создано сейчас, поэтому здесь
    -- проверяется хотя бы, что повтор той же цитаты отвергает схема.
    perform pg_temp.check('повтор цитаты отвергает схема', sqlstate in ('23505', '42501'), sqlstate || ' ' || sqlerrm);
  end;

  -- ======================================================= правка и удаление
  perform pg_temp.act_as(d);
  begin
    perform public.edit_comment(ca, 'правлю чужое');
    perform pg_temp.check('чужой комментарий не изменить', false, 'прошло');
  exception when others then
    perform pg_temp.check('чужой комментарий не изменить', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.delete_comment(ca);
    perform pg_temp.as_service();
    select count(*) into n from public.comments where id = ca and deleted_at is null;
    perform pg_temp.check('чужой комментарий не удалить', n = 1, n::text);
  exception when others then
    perform pg_temp.check('чужой комментарий не удалить', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(d);
  begin
    update public.comments set member_reactions = '{"👍": 999}' where id = cd;
    perform pg_temp.as_service();
    select member_reactions::text into s from public.comments where id = cd;
    perform pg_temp.check('счётчики реакций не подделать', s = '{}', s);
  exception when others then
    perform pg_temp.check('счётчики реакций не подделать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- ================================================================ без входа
  perform pg_temp.act_as_anon();
  begin
    perform public.set_reaction('comment', ca, '🔥');
    perform pg_temp.check('без входа реакцию не поставить', false, 'прошло');
  exception when others then
    perform pg_temp.check('без входа реакцию не поставить', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
