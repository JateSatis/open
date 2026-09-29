-- Удаление сообщений и закрепы: кто может, кто нет, и что база делает сама.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/message_delete_and_pins_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- Превью чата обновляет отложенный триггер в конце транзакции. Транзакция
-- здесь одна на весь файл, поэтому после вставок он запускается принудительно:
-- `set constraints all immediate`, затем обратно в отложенный режим.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'pa@test.local', '{"full_name":"Автор A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b1', 'pb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c1', 'pc@test.local', '{"full_name":"Участник C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d1', 'pd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

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
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b1';
  c uuid := '00000000-0000-4000-8000-0000000000c1';
  d uuid := '00000000-0000-4000-8000-0000000000d1';
  chat_ab uuid;
  chat_ac uuid;
  m1 uuid;
  m2 uuid;
  mb uuid;
  m3 uuid;
  other_chat_msg uuid;
  n int;
  s text;
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
  m1 := pg_temp.say(chat_ab, a, 'первое A', t);
  m2 := pg_temp.say(chat_ab, a, 'второе A', t + interval '1 minute');
  perform pg_temp.act_as(b);
  mb := pg_temp.say(chat_ab, b, 'ответ B', t + interval '2 minutes');
  perform pg_temp.act_as(a);
  m3 := pg_temp.say(chat_ab, a, 'третье A', t + interval '3 minutes');
  other_chat_msg := pg_temp.say(chat_ac, a, 'в другом чате', t);
  set constraints all immediate;
  set constraints all deferred;

  select last_message_text into s from public.chats where id = chat_ab;
  perform pg_temp.check('подготовка: превью — последнее сообщение', s = 'третье A', s);

  -- ====================================================== удаление: запреты
  perform pg_temp.act_as(b);

  begin
    perform public.delete_messages(array[m1]);
    perform pg_temp.check('не автор не удаляет функцией', false, 'прошло');
  exception when others then
    perform pg_temp.check('не автор не удаляет функцией', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Права на прямой UPDATE `messages` у клиента нет вовсе (20260929180000_message_edit.sql).
  begin
    update public.messages set deleted_at = now() where id = m1;
    get diagnostics n = row_count;
    perform pg_temp.check('не автор не удаляет прямым UPDATE (0 строк)', n = 0, n::text);
  exception when others then
    perform pg_temp.check('не автор не удаляет прямым UPDATE (0 строк)', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(d);

  begin
    perform public.delete_messages(array[m1]);
    perform pg_temp.check('посетитель не удаляет функцией', false, 'прошло');
  exception when others then
    perform pg_temp.check('посетитель не удаляет функцией', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as_anon();

  begin
    perform public.delete_messages(array[m1]);
    perform pg_temp.check('anon не вызывает delete_messages', false, 'прошло');
  exception when others then
    perform pg_temp.check('anon не вызывает delete_messages', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(a);

  begin
    update public.messages set deleted_at = now() where id = m1;
    get diagnostics n = row_count;
    perform pg_temp.check('автор не удаляет прямым UPDATE (упирается в RLS)', n = 0, n::text);
  exception when others then
    perform pg_temp.check('автор не удаляет прямым UPDATE (упирается в RLS)', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.delete_messages(array[m1, mb]);
    perform pg_temp.check('пачка с чужим сообщением отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('пачка с чужим сообщением отвергается', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.delete_messages(array[m1, other_chat_msg]);
    perform pg_temp.check('пачка из разных чатов отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('пачка из разных чатов отвергается', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.delete_messages(array[m1, gen_random_uuid()]);
    perform pg_temp.check('пачка с несуществующим id отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('пачка с несуществующим id отвергается', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  select count(*) into n from public.messages where id in (m1, m2, mb, m3) and deleted_at is null;
  perform pg_temp.check('после всех запретов все четыре сообщения живы', n = 4, n::text);

  -- ========================================================= закрепы: запреты
  perform pg_temp.act_as(d);

  begin
    perform public.pin_message(m1);
    perform pg_temp.check('посетитель не закрепляет функцией', false, 'прошло');
  exception when others then
    perform pg_temp.check('посетитель не закрепляет функцией', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.message_pins (chat_id, message_id, pinned_by) values (chat_ab, m1, d);
    perform pg_temp.check('посетитель не закрепляет прямой вставкой', false, 'прошло');
  exception when others then
    perform pg_temp.check('посетитель не закрепляет прямой вставкой', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- ======================================================= закрепы: разрешено
  perform pg_temp.act_as(b);
  perform public.pin_message(m1);
  perform pg_temp.act_as(a);
  perform public.pin_message(mb);

  select count(*) into n from public.message_pins where chat_id = chat_ab and deleted_at is null;
  perform pg_temp.check('участник закрепляет чужое и своё, закрепов несколько', n = 2, n::text);

  perform public.pin_message(mb);
  select count(*) into n from public.message_pins where message_id = mb and deleted_at is null;
  perform pg_temp.check('повторный закреп функцией не создаёт второй строки', n = 1, n::text);

  begin
    insert into public.message_pins (chat_id, message_id, pinned_by) values (chat_ab, mb, a);
    perform pg_temp.check('двойной закреп прямой вставкой отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('двойной закреп прямой вставкой отвергается', sqlstate = '23505', sqlstate || ' ' || sqlerrm);
  end;

  -- A — участник обоих чатов, но сообщение из одного чата в другом не закрепить.
  begin
    insert into public.message_pins (chat_id, message_id, pinned_by) values (chat_ab, other_chat_msg, a);
    perform pg_temp.check('сообщение из другого чата не закрепляется', false, 'прошло');
  exception when others then
    perform pg_temp.check('сообщение из другого чата не закрепляется', sqlstate in ('23503', '42501'), sqlstate || ' ' || sqlerrm);
  end;

  -- Та же проверка без RLS — ловит именно схема, а не политика.
  perform set_config('role', 'postgres', true);
  begin
    insert into public.message_pins (chat_id, message_id, pinned_by) values (chat_ab, other_chat_msg, a);
    perform pg_temp.check('схема: закреп с чужим chat_id отвергается внешним ключом', false, 'прошло');
  exception when others then
    perform pg_temp.check('схема: закреп с чужим chat_id отвергается внешним ключом', sqlstate = '23503', sqlstate || ' ' || sqlerrm);
  end;
  begin
    insert into public.message_pins (chat_id, message_id, pinned_by) values (chat_ab, mb, a);
    perform pg_temp.check('схема: двойной закреп отвергается индексом', false, 'прошло');
  exception when others then
    perform pg_temp.check('схема: двойной закреп отвергается индексом', sqlstate = '23505', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(d);
  select count(*) into n from public.message_pins where chat_id = chat_ab;
  perform pg_temp.check('посетитель видит закрепы', n = 2, n::text);

  begin
    perform public.unpin_message(m1);
    perform pg_temp.check('посетитель не открепляет функцией', false, 'прошло');
  exception when others then
    perform pg_temp.check('посетитель не открепляет функцией', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  update public.message_pins set deleted_at = now() where message_id = m1;
  get diagnostics n = row_count;
  perform pg_temp.check('посетитель не открепляет прямым UPDATE (0 строк)', n = 0, n::text);

  delete from public.message_pins where message_id = m1;
  get diagnostics n = row_count;
  perform pg_temp.check('посетитель не удаляет закреп (0 строк)', n = 0, n::text);

  -- Любой участник снимает любой закреп, в том числе поставленный другим.
  perform pg_temp.act_as(a);
  perform public.unpin_message(m1);
  select count(*) into n from public.message_pins where message_id = m1;
  perform pg_temp.check('участник открепляет закреп другого', n = 0, n::text);

  perform public.pin_message(m1);
  select count(*) into n from public.message_pins where message_id = m1;
  perform pg_temp.check('после открепления можно закрепить снова', n = 1, n::text);

  -- ===================================================== удаление: разрешено
  perform public.pin_message(m3);
  perform public.delete_messages(array[m2, m3]);

  perform pg_temp.act_as(b);
  select count(*) into n from public.messages where id in (m2, m3);
  perform pg_temp.check('удалённое не отдаётся обычной выборкой', n = 0, n::text);

  select count(*) into n
  from public.messages
  where chat_id = chat_ab and deleted_at is null;
  perform pg_temp.check('в переписке остались два живых', n = 2, n::text);

  select count(*) into n from public.message_tombstones(array[m1, m2, m3, mb]);
  perform pg_temp.check('по id видно, что удалены именно два', n = 2, n::text);

  select count(*) into n from public.message_pins where message_id = m3;
  perform pg_temp.check('закреп удалённого сообщения снят', n = 0, n::text);

  select last_message_text into s from public.chats where id = chat_ab;
  perform pg_temp.check('превью откатилось на предыдущее живое', s = 'ответ B', s);

  perform pg_temp.act_as(a);
  begin
    perform public.pin_message(m2);
    perform pg_temp.check('удалённое сообщение не закрепляется', false, 'прошло');
  exception when others then
    perform pg_temp.check('удалённое сообщение не закрепляется', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  perform public.delete_messages(array[m2]);
  perform pg_temp.check('повторное удаление своего — не ошибка', true);

  -- Последнее своё удалено, превью сверху — чужое, его не трогаем.
  perform public.delete_messages(array[m1]);
  select last_message_text into s from public.chats where id = chat_ab;
  perform pg_temp.check('удаление не последнего не трогает превью', s = 'ответ B', s);

  select count(*) into n from public.message_pins where chat_id = chat_ab;
  perform pg_temp.check('закреп удалённого m1 тоже снят', n = 1, n::text);

  perform pg_temp.act_as(b);
  perform public.delete_messages(array[mb]);
  select last_message_text into s from public.chats where id = chat_ab;
  perform pg_temp.check('живых не осталось — превью пустое', s is null, coalesce(s, 'null'));
  select count(*) into n from public.chats where id = chat_ab and last_message_at is null;
  perform pg_temp.check('живых не осталось — время превью пустое', n = 1, n::text);
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
