-- Просмотры сообщений: кто засчитывает, кто ставит «прочитано», что закрыто.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/message_views_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- Весь файл — одна транзакция с одним `now()`: «прошло больше 10 секунд»
-- изображается сдвигом `counted_at` назад от имени сервиса.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a7', 'va@test.local', '{"full_name":"Автор A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b7', 'vb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c7', 'vc@test.local', '{"full_name":"Приглашённый C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d7', 'vd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

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

-- «неуникальные/уникальные/прочитано» одной строкой.
create function pg_temp.views(msg uuid) returns text language sql as $$
  select views_count || '/' || unique_views_count || '/' || (read_at is not null)
  from public.messages where id = msg
$$;

-- Прошло больше 10 секунд с последнего засчитанного просмотра.
create function pg_temp.later(msg uuid) returns void language sql as $$
  update public.message_views set counted_at = counted_at - interval '11 seconds' where message_id = msg
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a7';
  b uuid := '00000000-0000-4000-8000-0000000000b7';
  c uuid := '00000000-0000-4000-8000-0000000000c7';
  d uuid := '00000000-0000-4000-8000-0000000000d7';
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  s3 uuid := gen_random_uuid();
  chat uuid;
  other_chat uuid;
  ma uuid;
  mb uuid;
  mo uuid;
  gone uuid;
  island uuid;
  n int;
  s text;
begin
  -- ------------------------------------------------------------- подготовка
  -- Чат A и B (C позван, не принял). Отдельный чат A и C — «другой».
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b, c], null) ->> 'chat_id')::uuid;
  other_chat := (public.create_chat(array[c], null) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);
  perform pg_temp.act_as(c);
  perform public.accept_chat_invite(other_chat);

  perform pg_temp.act_as(a);
  ma := pg_temp.say(chat, a, 'от A');
  gone := pg_temp.say(chat, a, 'будет удалено');
  perform public.delete_messages(array[gone]);
  mo := pg_temp.say(other_chat, a, 'из другого чата');
  island := public.forward_messages(chat, other_chat, array[mo]);
  perform pg_temp.act_as(b);
  mb := pg_temp.say(chat, b, 'от B');

  -- ======================================== новое сообщение — без просмотров
  s := pg_temp.views(ma);
  perform pg_temp.check('новое сообщение без просмотров и не прочитано', s = '0/0/false', s);

  perform pg_temp.act_as(a);

  begin
    insert into public.messages (chat_id, author_id, kind, text, views_count)
    values (chat, a, 'text', 'накрутка', 100);
    perform pg_temp.check('готовые просмотры с клиента не принимаются', false, 'вставилось');
  exception when others then
    perform pg_temp.check('готовые просмотры с клиента не принимаются', sqlstate = '42501', sqlstate);
  end;

  begin
    insert into public.messages (chat_id, author_id, kind, text, read_at)
    values (chat, a, 'text', 'сам себе прочитал', now());
    perform pg_temp.check('готовое «прочитано» с клиента не принимается', false, 'вставилось');
  exception when others then
    perform pg_temp.check('готовое «прочитано» с клиента не принимается', sqlstate = '42501', sqlstate);
  end;

  begin
    update public.messages set views_count = 100 where id = ma;
    perform pg_temp.check('счётчик напрямую не правится', false, 'обновилось');
  exception when others then
    perform pg_temp.check('счётчик напрямую не правится', sqlstate = '42501', sqlstate);
  end;

  -- ============================================== автор себе не накручивает
  perform public.record_message_views(chat, array[ma], s1);
  s := pg_temp.views(ma);
  perform pg_temp.check('автор свой просмотр не засчитывает', s = '0/0/false', s);

  -- ========================================== участник: просмотр и прочтение
  perform pg_temp.act_as(b);
  perform public.record_message_views(chat, array[ma, mb], s1);
  s := pg_temp.views(ma);
  perform pg_temp.check('участник засчитывает просмотр и прочтение', s = '1/1/true', s);
  s := pg_temp.views(mb);
  perform pg_temp.check('своё в той же пачке не засчитано', s = '0/0/false', s);

  perform public.record_message_views(chat, array[ma], s1);
  s := pg_temp.views(ma);
  perform pg_temp.check('та же сессия — не больше +1', s = '1/1/true', s);

  perform public.record_message_views(chat, array[ma], s2);
  s := pg_temp.views(ma);
  perform pg_temp.check('новая сессия сразу же — не засчитана (накрутка)', s = '1/1/true', s);

  perform pg_temp.as_service();
  perform pg_temp.later(ma);
  perform pg_temp.act_as(b);
  perform public.record_message_views(chat, array[ma], s3);
  s := pg_temp.views(ma);
  perform pg_temp.check('новая сессия позже — +1 неуникальный', s = '2/1/true', s);

  -- ===================================================== посетитель
  perform pg_temp.act_as(a);
  mb := pg_temp.say(chat, a, 'для посетителя');
  perform pg_temp.act_as(d);
  perform public.record_message_views(chat, array[mb], s1);
  s := pg_temp.views(mb);
  perform pg_temp.check('посетитель засчитывает просмотр, но не «прочитано»', s = '1/1/false', s);

  -- Приглашённый, но не принявший, — ещё не участник.
  perform pg_temp.act_as(c);
  perform public.record_message_views(chat, array[mb], s1);
  s := pg_temp.views(mb);
  perform pg_temp.check('не принявший приглашение не ставит «прочитано»', s = '2/2/false', s);

  -- ============================================ чужой чат, удалённое, островок
  perform pg_temp.act_as(d);
  perform public.record_message_views(chat, array[mo], s1);
  s := pg_temp.views(mo);
  perform pg_temp.check('сообщение другого чата через target_chat не засчитано', s = '0/0/false', s);

  perform public.record_message_views(chat, array[gone], s1);
  perform pg_temp.as_service();
  s := pg_temp.views(gone);
  perform pg_temp.check('удалённое не засчитано', s = '0/0/false', s);

  perform pg_temp.act_as(d);
  perform public.record_message_views(chat, array[island], s1);
  perform pg_temp.as_service();
  s := pg_temp.views(island);
  perform pg_temp.check('островок просмотров не принимает', s = '0/0/false', s);

  -- Оригинал островка — вызовом на чат оригинала; «прочитано» ставит только участник того чата.
  perform pg_temp.act_as(b);
  perform public.record_message_views(other_chat, array[mo], s1);
  s := pg_temp.views(mo);
  perform pg_temp.check('оригинал: участник другого чата не ставит «прочитано»', s = '1/1/false', s);

  perform pg_temp.act_as(c);
  perform public.record_message_views(other_chat, array[mo], s1);
  s := pg_temp.views(mo);
  perform pg_temp.check('оригинал: участник его чата ставит «прочитано»', s = '2/2/true', s);

  -- ===================================================== закрытость
  perform pg_temp.act_as(b);

  begin
    select count(*) into n from public.message_views;
    perform pg_temp.check('просмотры пользователю не видны', false, n::text);
  exception when others then
    perform pg_temp.check('просмотры пользователю не видны', sqlstate = '42501', sqlstate);
  end;

  begin
    insert into public.message_views (message_id, viewer_id, session_id) values (ma, b, s1);
    perform pg_temp.check('просмотр напрямую не пишется', false, 'вставилось');
  exception when others then
    perform pg_temp.check('просмотр напрямую не пишется', sqlstate = '42501', sqlstate);
  end;

  perform pg_temp.act_as_anon();

  begin
    perform public.record_message_views(chat, array[ma], s1);
    perform pg_temp.check('без входа просмотр не засчитать', false, 'прошло');
  exception when others then
    perform pg_temp.check('без входа просмотр не засчитать', sqlstate = '42501', sqlstate);
  end;
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
