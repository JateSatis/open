-- Границы доступа аккаунта и профиля: профиль, устройства, сеансы, удаление
-- аккаунта. Разрешённые и запрещённые пути.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/account_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- Действия «от имени пользователя» — через роль authenticated и
-- request.jwt.claims (с session_id, как в настоящем токене Auth), поэтому RLS,
-- права на колонки и проверки в функциях работают по-настоящему. Удаление
-- аккаунта воспроизводится так же, как его делает auth.admin.deleteUser:
-- удалением строки из auth.users.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'a@test.local', '{"full_name":"Тест A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b1', 'b@test.local', '{"full_name":"Тест B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c1', 'c@test.local', '{"full_name":"Тест C"}', 'authenticated', 'authenticated');

-- Сеансы: у A два устройства и один «осиротевший» сеанс, у B — один.
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000a1', now(), now()),
  ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000000a1', now(), now()),
  ('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-0000000000a1', now(), now()),
  ('00000000-0000-4000-8000-00000000a004', '00000000-0000-4000-8000-0000000000a1', now(), now()),
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000000b1', now(), now()),
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000c1', now(), now());

create function pg_temp.act_as(uid uuid, sid uuid) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid)::text,
    true
  );
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

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b1';
  c uuid := '00000000-0000-4000-8000-0000000000c1';
  sa_phone uuid := '00000000-0000-4000-8000-00000000a001';
  sa_emu uuid := '00000000-0000-4000-8000-00000000a002';
  sa_orphan uuid := '00000000-0000-4000-8000-00000000a003';
  sa_relogin uuid := '00000000-0000-4000-8000-00000000a004';
  sb uuid := '00000000-0000-4000-8000-00000000b001';
  sc uuid := '00000000-0000-4000-8000-00000000c001';
  install_phone uuid := '10000000-0000-4000-8000-000000000001';
  install_emu uuid := '10000000-0000-4000-8000-000000000002';
  install_b uuid := '10000000-0000-4000-8000-000000000003';
  dev_phone uuid;
  dev_emu uuid;
  dev_b uuid;
  chat_ab uuid;
  chat_group uuid;
  alive boolean;
  n int;
  s text;
begin
  -- ============================================================== профиль
  perform pg_temp.act_as(a, sa_phone);

  update public.profiles set display_name = 'Новое имя', status = 'в отпуске', bio = 'о себе',
    username = 'test_acc_a', avatar_url = 'https://example.test/a.jpg'
  where id = a;
  select display_name || '|' || status into s from public.profiles where id = a;
  perform pg_temp.check('владелец меняет имя, статус, описание, аватар', s = 'Новое имя|в отпуске', s);

  begin
    update public.profiles set deleted_at = now() where id = a;
    perform pg_temp.check('владелец не ставит себе deleted_at', false, 'прошло');
  exception when others then perform pg_temp.check('владелец не ставит себе deleted_at', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.profiles set id = gen_random_uuid() where id = a;
    perform pg_temp.check('владелец не меняет id', false, 'прошло');
  exception when others then perform pg_temp.check('владелец не меняет id', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.profiles set created_at = now() - interval '1 year' where id = a;
    perform pg_temp.check('владелец не меняет created_at', false, 'прошло');
  exception when others then perform pg_temp.check('владелец не меняет created_at', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    delete from public.profiles where id = a;
    perform pg_temp.check('владелец не удаляет строку профиля', false, 'прошло');
  exception when others then perform pg_temp.check('владелец не удаляет строку профиля', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.profiles (id, display_name) values (gen_random_uuid(), 'самозванец');
    perform pg_temp.check('профиль не создаётся прямым INSERT', false, 'прошло');
  exception when others then perform pg_temp.check('профиль не создаётся прямым INSERT', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  update public.profiles set display_name = 'Взлом', status = 'взлом' where id = b;
  get diagnostics n = row_count;
  perform pg_temp.check('чужой профиль не меняется (0 строк)', n = 0, n::text);

  begin
    update public.profiles set status = repeat('x', 201) where id = a;
    perform pg_temp.check('статус длиннее 200 символов отвергается', false, 'прошло');
  exception when others then perform pg_temp.check('статус длиннее 200 символов отвергается', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  select count(*) into n from public.profiles where id = a and deleted_at is null;
  perform pg_temp.check('профиль A на месте после всех попыток', n = 1);

  -- Посторонний видит статус в чужом профиле.
  perform pg_temp.act_as(b, sb);
  select status into s from public.profiles where id = a;
  perform pg_temp.check('B читает статус A', s = 'в отпуске', s);

  perform pg_temp.act_as_anon();
  begin
    update public.profiles set display_name = 'anon' where id = a;
    get diagnostics n = row_count;
    perform pg_temp.check('anon не меняет профиль', n = 0, n::text);
  exception when others then perform pg_temp.check('anon не меняет профиль', true, sqlerrm);
  end;

  -- ============================================================ устройства
  perform pg_temp.act_as(a, sa_phone);
  dev_phone := public.register_device(install_phone, 'android', 'RMX3840', '15', '1.0.0');
  perform pg_temp.act_as(a, sa_emu);
  dev_emu := public.register_device(install_emu, 'android', 'sdk_gphone64', '16', '1.0.0');
  perform pg_temp.act_as(b, sb);
  dev_b := public.register_device(install_b, 'ios', 'iPhone 15', '18.2', '1.0.0');

  perform pg_temp.act_as(a, sa_phone);
  select count(*) into n from public.devices;
  perform pg_temp.check('A видит только свои устройства (2)', n = 2, n::text);
  select session_id::text into s from public.devices where id = dev_phone;
  perform pg_temp.check('устройство связано с session_id из JWT', s = sa_phone::text, s);

  -- Повторная регистрация той же установки не плодит строк.
  perform public.register_device(install_phone, 'android', 'RMX3840', '15.1', '1.0.1');
  select count(*) into n from public.devices;
  perform pg_temp.check('повторная регистрация переиспользует строку', n = 2, n::text);

  perform pg_temp.act_as(b, sb);
  select count(*) into n from public.devices where user_id = a;
  perform pg_temp.check('B не читает устройства A', n = 0, n::text);

  perform pg_temp.act_as_anon();
  begin
    select count(*) into n from public.devices;
    perform pg_temp.check('anon не читает устройства', n = 0, n::text);
  exception when others then perform pg_temp.check('anon не читает устройства', true, sqlerrm);
  end;

  perform pg_temp.act_as(b, sb);
  begin
    insert into public.devices (user_id, installation_id, platform) values (a, gen_random_uuid(), 'android');
    perform pg_temp.check('устройство не вставляется напрямую (даже чужое)', false, 'прошло');
  exception when others then perform pg_temp.check('устройство не вставляется напрямую (даже чужое)', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.devices set model = 'взлом' where id = dev_phone;
    perform pg_temp.check('B не меняет устройство A', false, 'прошло');
  exception when others then perform pg_temp.check('B не меняет устройство A', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    delete from public.devices where id = dev_phone;
    perform pg_temp.check('B не удаляет устройство A', false, 'прошло');
  exception when others then perform pg_temp.check('B не удаляет устройство A', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(a, sa_phone);
  begin
    update public.devices set session_id = sb where id = dev_phone;
    perform pg_temp.check('A не переписывает session_id своего устройства', false, 'прошло');
  exception when others then perform pg_temp.check('A не переписывает session_id своего устройства', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- ================================================================ сеансы
  -- B пытается завершить сеанс A по id устройства A — функция его не находит.
  perform pg_temp.act_as(b, sb);
  perform public.end_device_session(dev_phone);
  perform public.end_device_session(dev_emu);
  perform set_config('role', 'postgres', true);
  select count(*) into n from auth.sessions where id in (sa_phone, sa_emu);
  perform pg_temp.check('B не завершает сеансы A', n = 2, n::text);
  select count(*) into n from public.devices where id in (dev_phone, dev_emu) and signed_out_at is null;
  perform pg_temp.check('устройства A не помечены после попытки B', n = 2, n::text);

  -- A с телефона завершает эмулятор.
  perform pg_temp.act_as(a, sa_phone);
  perform public.end_device_session(dev_emu);
  perform set_config('role', 'postgres', true);
  select count(*) into n from auth.sessions where id = sa_emu;
  perform pg_temp.check('A завершает сеанс своего эмулятора', n = 0, n::text);
  select count(*) into n from public.devices where id = dev_emu and session_id is null and signed_out_at is not null;
  perform pg_temp.check('устройство эмулятора помечено и отвязано от сеанса', n = 1, n::text);
  select count(*) into n from auth.sessions where id = sa_phone;
  perform pg_temp.check('сеанс телефона A не тронут', n = 1, n::text);

  -- Завершённый эмулятор узнаёт об этом при возврате в приложение.
  perform pg_temp.act_as(a, sa_emu);
  alive := public.touch_device(install_emu);
  perform pg_temp.check('touch_device с завершённого сеанса → false', alive = false, alive::text);
  begin
    perform public.register_device(install_emu, 'android', 'sdk_gphone64', '16', '1.0.0');
    perform pg_temp.check('завершённый сеанс не регистрируется заново', false, 'прошло');
  exception when others then perform pg_temp.check('завершённый сеанс не регистрируется заново', true, sqlerrm);
  end;

  perform pg_temp.act_as(a, sa_phone);
  alive := public.touch_device(install_phone);
  perform pg_temp.check('touch_device с живого сеанса → true', alive = true, alive::text);

  -- Повторный вход на эмуляторе: новый сеанс, та же строка.
  perform pg_temp.act_as(a, sa_relogin);
  perform public.register_device(install_emu, 'android', 'sdk_gphone64', '16', '1.0.0');
  select count(*) into n from public.devices
  where id = dev_emu and session_id = sa_relogin and signed_out_at is null;
  perform pg_temp.check('повторный вход оживляет ту же строку устройства', n = 1, n::text);

  -- «Завершить все, кроме этого» с телефона: эмулятор и осиротевший сеанс
  -- уходят, сеанс телефона и чужие сеансы остаются.
  perform pg_temp.act_as(a, sa_phone);
  perform public.end_other_sessions();
  perform set_config('role', 'postgres', true);
  select count(*) into n from auth.sessions where user_id = a;
  perform pg_temp.check('у A остался один сеанс', n = 1, n::text);
  select count(*) into n from auth.sessions where id = sa_phone;
  perform pg_temp.check('и это сеанс телефона', n = 1, n::text);
  select count(*) into n from auth.sessions where id = sa_orphan;
  perform pg_temp.check('осиротевший сеанс A завершён', n = 0, n::text);
  select count(*) into n from auth.sessions where id in (sb, sc);
  perform pg_temp.check('сеансы B и C не тронуты', n = 2, n::text);

  -- Выход с телефона: отметка на устройстве.
  perform pg_temp.act_as(a, sa_phone);
  perform public.mark_device_signed_out(install_phone);
  perform pg_temp.act_as(b, sb);
  perform public.mark_device_signed_out(install_phone);
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.devices where id = dev_phone and signed_out_at is not null;
  perform pg_temp.check('выход помечает своё устройство', n = 1, n::text);
  select count(*) into n from public.devices where id = dev_b and signed_out_at is null;
  perform pg_temp.check('устройство B не помечено чужим выходом', n = 1, n::text);

  perform pg_temp.act_as_anon();
  begin
    perform public.end_other_sessions();
    perform pg_temp.check('anon не вызывает end_other_sessions', false, 'прошло');
  exception when others then perform pg_temp.check('anon не вызывает end_other_sessions', true, sqlerrm);
  end;

  -- ======================================================= удаление аккаунта
  -- Переписка: A и B в диалоге, A зовёт C в группу, C не отвечает.
  perform set_config('role', 'postgres', true);
  insert into auth.sessions (id, user_id, created_at, updated_at) values (sa_emu, a, now(), now());
  perform pg_temp.act_as(a, sa_emu);
  perform public.register_device(install_emu, 'android', 'sdk_gphone64', '16', '1.0.0');

  chat_ab := (public.create_chat(array[b], null) ->> 'chat_id')::uuid;
  chat_group := (public.create_chat(array[b, c], 'Группа') ->> 'chat_id')::uuid;
  insert into public.messages (chat_id, author_id, kind, text) values (chat_ab, a, 'text', 'от A');
  perform pg_temp.act_as(b, sb);
  perform public.accept_chat_invite(chat_ab);
  perform public.accept_chat_invite(chat_group);
  insert into public.messages (chat_id, author_id, kind, text) values (chat_ab, b, 'text', 'от B');
  insert into public.messages (chat_id, author_id, kind, text) values (chat_group, b, 'text', 'в группе');

  -- Так делает auth.admin.deleteUser.
  perform set_config('role', 'postgres', true);
  begin
    delete from auth.users where id = a;
    perform pg_temp.check('удаление пользователя с перепиской проходит', true);
  exception when others then perform pg_temp.check('удаление пользователя с перепиской проходит', false, sqlstate || ' ' || sqlerrm);
  end;

  select count(*) into n from public.profiles where id = a;
  perform pg_temp.check('профиль ушёл каскадом', n = 0, n::text);
  select count(*) into n from public.devices where user_id = a;
  perform pg_temp.check('устройства ушли каскадом', n = 0, n::text);
  select count(*) into n from auth.sessions where user_id = a;
  perform pg_temp.check('сеансы ушли каскадом', n = 0, n::text);

  perform pg_temp.act_as(b, sb);
  select count(*) into n from public.chats where id in (chat_ab, chat_group) and deleted_at is null;
  perform pg_temp.check('оба чата открываются', n = 2, n::text);
  select count(*) into n from public.messages where chat_id = chat_ab;
  perform pg_temp.check('сообщения диалога на месте (2)', n = 2, n::text);
  select count(*) into n from public.messages where chat_id = chat_ab and author_id is null and text = 'от A';
  perform pg_temp.check('сообщение A осталось без автора', n = 1, n::text);
  select count(*) into n from public.chat_members where chat_id = chat_ab and user_id = b;
  perform pg_temp.check('B остался участником диалога', n = 1, n::text);
  select count(*) into n from public.chat_waiting_invitees where chat_id = chat_group;
  perform pg_temp.check('ждущий C по-прежнему виден в группе', n = 1, n::text);

  insert into public.messages (chat_id, author_id, kind, text) values (chat_ab, b, 'text', 'после удаления');
  perform pg_temp.check('B пишет в диалог после удаления A', true);

  perform pg_temp.act_as(c, sc);
  perform public.accept_chat_invite(chat_group);
  select count(*) into n from public.chat_members where chat_id = chat_group and user_id = c;
  perform pg_temp.check('C принимает заявку удалённого A', n = 1, n::text);
  select count(*) into n from public.chat_invites where chat_id = chat_group and invitee_id = c and inviter_id is null;
  perform pg_temp.check('заявка C хранится без приглашавшего', n = 1, n::text);
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
