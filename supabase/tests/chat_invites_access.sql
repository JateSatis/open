-- Границы доступа заявок в чат: разрешённые и запрещённые пути.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/chat_invites_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- Действия «от имени пользователя» — через роль authenticated и
-- request.jwt.claims, как это делает PostgREST, поэтому RLS и права на колонки
-- проверяются по-настоящему. Четыре пользователя заводятся в транзакции.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated;
grant all on results_n_seq to authenticated;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'a@test.local', '{"full_name":"Тест A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'b@test.local', '{"full_name":"Тест B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000c', 'c@test.local', '{"full_name":"Тест C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000d', 'd@test.local', '{"full_name":"Тест D"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000e', 'e@test.local', '{"full_name":"Тест E"}', 'authenticated', 'authenticated');

update public.profiles set deleted_at = now() where id = '00000000-0000-4000-8000-00000000000e';

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-00000000000a';
  b uuid := '00000000-0000-4000-8000-00000000000b';
  c uuid := '00000000-0000-4000-8000-00000000000c';
  d uuid := '00000000-0000-4000-8000-00000000000d';
  e uuid := '00000000-0000-4000-8000-00000000000e';
  res jsonb;
  chat_ab uuid;
  chat_ab2 uuid;
  chat_group uuid;
  n int;
  s text;
begin
  -- ---------------------------------------------------------------- создание
  perform pg_temp.act_as(a);
  res := public.create_chat(array[b], null);
  chat_ab := (res ->> 'chat_id')::uuid;
  perform pg_temp.check('A создаёт диалог с B', res ->> 'outcome' = 'created', res::text);

  select count(*) into n from public.chat_members where chat_id = chat_ab and user_id = a;
  perform pg_temp.check('создатель сразу участник', n = 1);
  select count(*) into n from public.chat_members where chat_id = chat_ab and user_id = b;
  perform pg_temp.check('приглашённый ещё не участник', n = 0);
  select kind into s from public.chats where id = chat_ab;
  perform pg_temp.check('один приглашённый — direct', s = 'direct', s);

  begin
    perform public.create_chat(array[a], null);
    perform pg_temp.check('нельзя позвать себя', false, 'прошло');
  exception when others then perform pg_temp.check('нельзя позвать себя', true, sqlerrm);
  end;

  begin
    perform public.create_chat(array[b, a], null);
    perform pg_temp.check('нельзя позвать себя в группу', false, 'прошло');
  exception when others then perform pg_temp.check('нельзя позвать себя в группу', true, sqlerrm);
  end;

  begin
    perform public.create_chat(array[e], null);
    perform pg_temp.check('нельзя позвать удалённый профиль', false, 'прошло');
  exception when others then perform pg_temp.check('нельзя позвать удалённый профиль', true, sqlerrm);
  end;

  begin
    perform public.create_chat(array[gen_random_uuid()], null);
    perform pg_temp.check('нельзя позвать несуществующего', false, 'прошло');
  exception when others then perform pg_temp.check('нельзя позвать несуществующего', true, sqlerrm);
  end;

  begin
    perform public.create_chat(array[b], 'другое название');
    perform pg_temp.check('повтор набора при ждущей заявке отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('повтор набора при ждущей заявке отвергается', sqlstate = 'OPN01', sqlstate || ' ' || sqlerrm);
  end;

  -- ------------------------------------------------ прямые записи в обход функций
  begin
    insert into public.chat_members (chat_id, user_id) values (chat_ab, b);
    perform pg_temp.check('участник не добавляет другого напрямую', false, 'прошло');
  exception when others then perform pg_temp.check('участник не добавляет другого напрямую', true, sqlerrm);
  end;

  begin
    insert into public.chats (kind, created_by) values ('direct', a);
    perform pg_temp.check('чат нельзя создать прямым INSERT', false, 'прошло');
  exception when others then perform pg_temp.check('чат нельзя создать прямым INSERT', true, sqlerrm);
  end;

  begin
    update public.chats set created_by = b where id = chat_ab;
    perform pg_temp.check('создатель не меняет created_by', false, 'прошло');
  exception when others then perform pg_temp.check('создатель не меняет created_by', true, sqlerrm);
  end;

  begin
    update public.chats set founding_member_ids = '{}' where id = chat_ab;
    perform pg_temp.check('создатель не меняет исходный набор', false, 'прошло');
  exception when others then perform pg_temp.check('создатель не меняет исходный набор', true, sqlerrm);
  end;

  update public.chats set title = 'Переименован' where id = chat_ab;
  select title into s from public.chats where id = chat_ab;
  perform pg_temp.check('создатель переименовывает чат', s = 'Переименован', s);

  select count(*) into n from public.chat_invites where chat_id = chat_ab;
  perform pg_temp.check('создатель не видит строк chat_invites', n = 0, n::text);

  -- ---------------------------------------------------------- посторонний C
  perform pg_temp.act_as(c);

  begin
    insert into public.chat_members (chat_id, user_id) values (chat_ab, c);
    perform pg_temp.check('посторонний не вступает прямым INSERT', false, 'прошло');
  exception when others then perform pg_temp.check('посторонний не вступает прямым INSERT', true, sqlerrm);
  end;

  begin
    insert into public.messages (chat_id, author_id, kind, text) values (chat_ab, c, 'text', 'я тут');
    perform pg_temp.check('посторонний не пишет в чат', false, 'прошло');
  exception when others then perform pg_temp.check('посторонний не пишет в чат', true, sqlerrm);
  end;

  begin
    perform public.accept_chat_invite(chat_ab);
    perform pg_temp.check('чужую заявку нельзя принять', false, 'прошло');
  exception when others then perform pg_temp.check('чужую заявку нельзя принять', true, sqlerrm);
  end;

  begin
    perform public.decline_chat_invite(chat_ab);
    perform pg_temp.check('чужую заявку нельзя отклонить', false, 'прошло');
  exception when others then perform pg_temp.check('чужую заявку нельзя отклонить', true, sqlerrm);
  end;

  begin
    update public.chat_invites set status = 'accepted', accepted_at = now() where chat_id = chat_ab;
    get diagnostics n = row_count;
    perform pg_temp.check('заявку нельзя поменять UPDATE-ом', n = 0, 'строк: ' || n);
  exception when others then perform pg_temp.check('заявку нельзя поменять UPDATE-ом', true, sqlerrm);
  end;

  begin
    insert into public.chat_invites (chat_id, inviter_id, invitee_id) values (chat_ab, a, c);
    perform pg_temp.check('заявку нельзя вставить напрямую', false, 'прошло');
  exception when others then perform pg_temp.check('заявку нельзя вставить напрямую', true, sqlerrm);
  end;

  select count(*) into n from public.chat_waiting_invitees where chat_id = chat_ab and user_id = b;
  perform pg_temp.check('посетитель видит, что B не ответил', n = 1, n::text);

  -- ------------------------------------------------------------ приглашённый B
  perform pg_temp.act_as(b);

  select status into s from public.chat_invites where chat_id = chat_ab and invitee_id = b;
  perform pg_temp.check('приглашённый видит свою заявку', s = 'pending', s);

  begin
    insert into public.messages (chat_id, author_id, kind, text) values (chat_ab, b, 'text', 'до принятия');
    perform pg_temp.check('приглашённый не пишет до принятия', false, 'прошло');
  exception when others then perform pg_temp.check('приглашённый не пишет до принятия', true, sqlerrm);
  end;

  begin
    insert into public.chat_members (chat_id, user_id) values (chat_ab, b);
    perform pg_temp.check('приглашённый не вступает прямым INSERT', false, 'прошло');
  exception when others then perform pg_temp.check('приглашённый не вступает прямым INSERT', true, sqlerrm);
  end;

  res := public.create_chat(array[a], null);
  perform pg_temp.check(
    'встречная заявка открывает чат от A',
    res ->> 'outcome' = 'incoming_invite' and (res ->> 'chat_id')::uuid = chat_ab,
    res::text
  );

  perform public.decline_chat_invite(chat_ab);
  select status into s from public.chat_invites where chat_id = chat_ab and invitee_id = b;
  perform pg_temp.check('B отклоняет входящую', s = 'declined', s);

  -- ------------------------------------------------------ создатель после отказа
  perform pg_temp.act_as(a);

  select count(*) into n from public.chat_invites where chat_id = chat_ab;
  perform pg_temp.check('создатель не видит отказ в chat_invites', n = 0, n::text);

  select count(*) into n from public.chat_waiting_invitees where chat_id = chat_ab and user_id = b;
  perform pg_temp.check('отказ для создателя выглядит как «не ответил»', n = 1, n::text);

  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'chat_waiting_invitees'
    and column_name in ('status', 'declined_at', 'accepted_at');
  perform pg_temp.check('в публичном view нет статуса и меток', n = 0, n::text);

  begin
    perform public.create_chat(array[b], null);
    perform pg_temp.check('повтор набора при отклонённой заявке отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('повтор набора при отклонённой заявке отвергается', sqlstate = 'OPN01', sqlstate || ' ' || sqlerrm);
  end;

  -- ------------------------------------------------------- B передумал и принял
  perform pg_temp.act_as(b);

  perform public.accept_chat_invite(chat_ab);
  select count(*) into n from public.chat_members where chat_id = chat_ab and user_id = b;
  perform pg_temp.check('отклонённую заявку можно принять', n = 1, n::text);

  insert into public.messages (chat_id, author_id, kind, text) values (chat_ab, b, 'text', 'привет');
  perform pg_temp.check('принявший пишет в чат', true);

  begin
    perform public.decline_chat_invite(chat_ab);
    perform pg_temp.check('принятую заявку нельзя отклонить', false, 'прошло');
  exception when others then perform pg_temp.check('принятую заявку нельзя отклонить', true, sqlerrm);
  end;

  begin
    update public.chat_members set chat_id = gen_random_uuid() where chat_id = chat_ab and user_id = b;
    perform pg_temp.check('участник не переносит свою строку в другой чат', false, 'прошло');
  exception when others then perform pg_temp.check('участник не переносит свою строку в другой чат', true, sqlerrm);
  end;

  perform public.mark_chat_read(chat_ab);
  perform pg_temp.check('отметка прочтения по-прежнему пишется', true);

  begin
    update public.messages set chat_id = gen_random_uuid() where chat_id = chat_ab and author_id = b;
    perform pg_temp.check('автор не переносит сообщение в другой чат', false, 'прошло');
  exception when others then perform pg_temp.check('автор не переносит сообщение в другой чат', true, sqlerrm);
  end;

  select count(*) into n from public.latest_chat_messages(array[chat_ab], 3);
  perform pg_temp.check('последние сообщения чата читаются', n = 1, n::text);

  -- ------------------------------------------------ после принятия всеми — можно
  perform pg_temp.act_as(a);

  select count(*) into n from public.chat_waiting_invitees where chat_id = chat_ab;
  perform pg_temp.check('принявший пропадает из «не ответил»', n = 0, n::text);

  res := public.create_chat(array[b], 'второй');
  chat_ab2 := (res ->> 'chat_id')::uuid;
  perform pg_temp.check(
    'после принятия всеми новый диалог создаётся',
    res ->> 'outcome' = 'created' and chat_ab2 <> chat_ab,
    res::text
  );

  -- ---------------------------------------------------------------- группа
  res := public.create_chat(array[b, c], '  Группа  ');
  chat_group := (res ->> 'chat_id')::uuid;
  select kind || '|' || title into s from public.chats where id = chat_group;
  perform pg_temp.check('несколько приглашённых — group с названием', s = 'group|Группа', s);

  begin
    perform public.create_chat(array[c, b, c], null);
    perform pg_temp.check('повтор группы (другой порядок, дубли) отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('повтор группы (другой порядок, дубли) отвергается', sqlstate = 'OPN01', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(d);
  select count(*) into n from public.chat_waiting_invitees where chat_id = chat_group;
  perform pg_temp.check('посетитель видит двух неответивших в группе', n = 2, n::text);

  perform pg_temp.act_as(c);
  res := public.create_chat(array[a, b], null);
  perform pg_temp.check(
    'встречная заявка в группу открывает чат A',
    res ->> 'outcome' = 'incoming_invite' and (res ->> 'chat_id')::uuid = chat_group,
    res::text
  );

  -- ----------------------------------------------- переходы статуса в самой базе
  perform set_config('role', 'postgres', true);

  begin
    update public.chat_invites set status = 'pending', accepted_at = null where chat_id = chat_ab;
    perform pg_temp.check('база не пускает accepted → pending', false, 'прошло');
  exception when others then perform pg_temp.check('база не пускает accepted → pending', true, sqlerrm);
  end;

  begin
    update public.chat_invites set status = 'declined', declined_at = now(), accepted_at = null where chat_id = chat_ab;
    perform pg_temp.check('база не пускает accepted → declined', false, 'прошло');
  exception when others then perform pg_temp.check('база не пускает accepted → declined', true, sqlerrm);
  end;

  begin
    update public.chat_invites set status = 'accepted' where chat_id = chat_group and invitee_id = c;
    perform pg_temp.check('CHECK: accepted без accepted_at', false, 'прошло');
  exception when others then perform pg_temp.check('CHECK: accepted без accepted_at', true, sqlerrm);
  end;
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
