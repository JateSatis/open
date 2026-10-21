-- Управление группой: настраивает и удаляет участников только владелец, звать
-- может любой участник, уйти — только функцией, владение переходит само;
-- личный диалог удаляет только его участник, мягко; поиск в чате.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/group_management_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000002a1', 'ga@test.local', '{"full_name":"Аня"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000002b1', 'gb@test.local', '{"full_name":"Борис"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000002c1', 'gc@test.local', '{"full_name":"Виктор"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000002d1', 'gd@test.local', '{"full_name":"Дина"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000002e1', 'ge@test.local', '{"full_name":"Егор"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid,
    'role', 'authenticated',
    'iss', 'https://proj.supabase.co/auth/v1'
  )::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void language sql as $$
  insert into results (name, ok, detail) values (name, coalesce(ok, false), detail);
$$;

create function pg_temp.flush() returns void language plpgsql as $$
begin
  set constraints all immediate;
  set constraints all deferred;
end;
$$;

create function pg_temp.denied(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate;
end;
$$;

-- Тестовые аккаунты рождаются с защитными настройками приватности
-- (20261029100000_privacy_settings.sql). Здесь проверяется не она: время,
-- «в сети» и поиск открыты всем — их скрытие проверяет
-- privacy_activity_search_access.sql.
update public.privacy_settings set
  message_activity_metadata_visibility = 'everyone',
  activity_status_visibility = 'everyone',
  account_search_visibility = 'everyone'
where user_id in (select id from auth.users where email like '%@test.local');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000002a1';
  b uuid := '00000000-0000-4000-8000-0000000002b1';
  c uuid := '00000000-0000-4000-8000-0000000002c1';
  d uuid := '00000000-0000-4000-8000-0000000002d1';
  e uuid := '00000000-0000-4000-8000-0000000002e1';
  grp uuid;
  dm uuid;
  code text;
  n int;
  s text;
begin
  -- --------------------------------------------------------------- засев
  perform pg_temp.act_as(a);
  grp := (public.create_chat(array[b, c], 'Группа') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(grp);
  perform pg_temp.act_as(c);
  perform public.accept_chat_invite(grp);

  perform pg_temp.check('новая группа: владелец — создатель',
    (select owner_id from public.chats where id = grp) = a);
  perform pg_temp.check('принял заявку — строка «вступил(а)»',
    exists (select 1 from public.messages
            where chat_id = grp and system_event = 'member_joined' and author_id = b));

  -- --------------------------------------------------------------- право настраивать
  for s in select unnest(array[
    format('select public.set_chat_title(%L, %L)', grp, 'Новое'),
    format('select public.set_chat_avatar(%L, %L)', grp, ''),
    format('select public.set_chat_username(%L, %L)', grp, 'grp_test_x'),
    format('select public.set_chat_description(%L, %L)', grp, 'Описание')
  ]) loop
    perform pg_temp.act_as(b);
    code := pg_temp.denied(s);
    perform pg_temp.check('участник-не-владелец: отказ — ' || split_part(s, '(', 1), code = '42501', code);

    perform pg_temp.act_as(d);
    code := pg_temp.denied(s);
    perform pg_temp.check('посторонний: отказ — ' || split_part(s, '(', 1), code = '42501', code);

    perform pg_temp.act_as(a);
    code := pg_temp.denied(s);
    perform pg_temp.check('владелец: успех — ' || split_part(s, '(', 1), code is null, code);
  end loop;

  perform pg_temp.check('описание сохранено',
    (select description from public.chats where id = grp) = 'Описание');

  perform pg_temp.act_as(a);
  perform public.set_chat_description(grp, '   ');
  perform pg_temp.check('пустое описание — null',
    (select description from public.chats where id = grp) is null);

  perform pg_temp.act_as(a);
  code := pg_temp.denied(format('update public.chats set title = %L where id = %L', 'Мимо', grp));
  perform pg_temp.check('прямой UPDATE названия: отказ', code = '42501', code);

  perform pg_temp.act_as(a);
  dm := (public.create_chat(array[e], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  code := pg_temp.denied(format('select public.set_chat_description(%L, %L)', dm, 'x'));
  perform pg_temp.check('описание у диалога: отказ', code = '22023', code);

  -- --------------------------------------------------------------- ссылка состава в обычном сообщении
  perform pg_temp.act_as(b);
  code := pg_temp.denied(format(
    'insert into public.messages (chat_id, author_id, kind, text, system_user_id) values (%L, %L, %L, %L, %L)',
    grp, b, 'text', 'подделка', c));
  perform pg_temp.check('обычное сообщение со «вторым человеком события»: отказ', code is not null, code);

  -- --------------------------------------------------------------- приглашение
  perform pg_temp.act_as(d);
  code := pg_temp.denied(format('select public.invite_to_chat(%L, array[%L]::uuid[])', grp, e));
  perform pg_temp.check('посторонний зовёт: отказ', code = '42501', code);

  perform pg_temp.act_as(b);
  n := public.invite_to_chat(grp, array[d, e, c]);
  perform pg_temp.check('участник зовёт двоих, участник пропущен', n = 2, n::text);
  perform pg_temp.check('заявки ждут ответа',
    (select count(*) from public.chat_waiting_invitees
     where chat_id = grp and user_id in (d, e)) = 2);
  perform pg_temp.check('строки «пригласил(а)» — по одной на человека',
    (select count(*) from public.messages
     where chat_id = grp and system_event = 'member_invited' and author_id = b) = 2);
  perform pg_temp.check('текст приглашения — с именами',
    exists (select 1 from public.messages
            where chat_id = grp and system_event = 'member_invited' and text = 'Борис пригласил(а) Дина'));

  perform pg_temp.act_as(c);
  n := public.invite_to_chat(grp, array[d]);
  perform pg_temp.check('повторно позванный — пропущен', n = 0, n::text);

  perform pg_temp.act_as(d);
  perform public.decline_chat_invite(grp);
  perform pg_temp.act_as(c);
  n := public.invite_to_chat(grp, array[d]);
  perform pg_temp.act_as(d);
  perform pg_temp.check('отказавшегося можно позвать снова', n = 1 and
    (select status from public.chat_invites where chat_id = grp and invitee_id = d) = 'pending', n::text);

  -- --------------------------------------------------------------- отмена приглашения
  perform pg_temp.act_as(b);
  code := pg_temp.denied(format('select public.cancel_chat_invite(%L, %L)', grp, e));
  perform pg_temp.check('не владелец отменяет приглашение: отказ', code = '42501', code);

  perform pg_temp.act_as(a);
  perform public.cancel_chat_invite(grp, e);
  perform pg_temp.act_as(e);
  perform pg_temp.check('владелец отменил приглашение — заявки нет',
    not exists (select 1 from public.chat_invites where chat_id = grp and invitee_id = e));

  perform pg_temp.act_as(d);
  perform public.accept_chat_invite(grp);

  -- --------------------------------------------------------------- удаление участника
  perform pg_temp.act_as(b);
  code := pg_temp.denied(format('select public.remove_chat_member(%L, %L)', grp, c));
  perform pg_temp.check('не владелец удаляет участника: отказ', code = '42501', code);

  perform pg_temp.act_as(a);
  code := pg_temp.denied(format('select public.remove_chat_member(%L, %L)', grp, a));
  perform pg_temp.check('владелец удаляет себя: отказ', code = '22023', code);

  perform public.remove_chat_member(grp, d);
  perform pg_temp.check('владелец удалил участника',
    not exists (select 1 from public.chat_members where chat_id = grp and user_id = d));
  perform pg_temp.check('строка «удалил(а)»',
    exists (select 1 from public.messages
            where chat_id = grp and system_event = 'member_removed' and author_id = a and system_user_id = d));

  perform pg_temp.act_as(d);
  code := pg_temp.denied(format(
    'insert into public.messages (chat_id, author_id, kind, text) values (%L, %L, %L, %L)', grp, d, 'text', 'я тут'));
  perform pg_temp.check('удалённый больше не пишет', code = '42501', code);

  perform pg_temp.act_as(b);
  n := public.invite_to_chat(grp, array[d]);
  perform pg_temp.check('удалённого можно позвать снова', n = 1, n::text);

  -- --------------------------------------------------------------- выход
  perform pg_temp.act_as(b);
  code := pg_temp.denied(format('delete from public.chat_members where chat_id = %L and user_id = %L', grp, b));
  perform pg_temp.check('прямой DELETE своей строки участника: отказ',
    code = '42501' and exists (select 1 from public.chat_members where chat_id = grp and user_id = b), code);

  perform pg_temp.act_as(e);
  code := pg_temp.denied(format('select public.leave_chat(%L)', grp));
  perform pg_temp.check('посторонний выходит: отказ', code = '42501', code);

  perform pg_temp.act_as(a);
  perform public.leave_chat(grp);
  perform pg_temp.check('владелец ушёл — владение у самого давнего',
    (select owner_id from public.chats where id = grp) = b);
  perform pg_temp.check('строки «покинул(а)» и «Владельцем стал(а)» по порядку',
    (select array_agg(system_event order by seq) from (
      select system_event, seq from public.message_rows
      where chat_id = grp and system_event in ('member_left', 'owner_changed')
    ) x) = array['member_left', 'owner_changed']);
  -- Превью пишет отложенный триггер — на коммите.
  perform pg_temp.flush();
  perform pg_temp.check('превью «Чатов» — смена владельца',
    (select last_message_text from public.chats where id = grp) = 'Владельцем стал(а) Борис',
    (select last_message_text from public.chats where id = grp));

  perform pg_temp.act_as(b);
  code := pg_temp.denied(format('select public.set_chat_title(%L, %L)', grp, 'От Бориса'));
  perform pg_temp.check('новый владелец настраивает группу', code is null, code);

  perform pg_temp.act_as(a);
  code := pg_temp.denied(format('select public.set_chat_title(%L, %L)', grp, 'От Ани'));
  perform pg_temp.check('бывший владелец — посторонний: отказ', code = '42501', code);

  -- --------------------------------------------------------------- удаление аккаунта владельца
  perform pg_temp.as_admin();
  delete from auth.users where id = b;
  perform pg_temp.check('владелец удалил аккаунт — владение у Виктора',
    (select owner_id from public.chats where id = grp) = c);
  perform pg_temp.check('строка «Владельцем стал(а)» после удаления аккаунта',
    exists (select 1 from public.messages
            where chat_id = grp and system_event = 'owner_changed' and system_user_id = c));
  perform pg_temp.check('строки удалённого аккаунта остались без автора',
    exists (select 1 from public.messages
            where chat_id = grp and system_event = 'member_invited' and author_id is null));

  -- --------------------------------------------------------------- последний участник
  perform pg_temp.act_as(c);
  perform public.leave_chat(grp);
  perform pg_temp.check('последний ушёл — группа без участников и владельца',
    not exists (select 1 from public.chat_members where chat_id = grp)
    and (select owner_id from public.chats where id = grp) is null);

  -- --------------------------------------------------------------- удаление диалога
  perform pg_temp.act_as(e);
  perform public.accept_chat_invite(dm);
  perform pg_temp.act_as(a);
  insert into public.messages (chat_id, author_id, kind, text, created_at)
    values (dm, a, 'text', 'секретное слово тюльпан', now() - interval '1 minute');
  insert into public.messages (chat_id, author_id, kind, text)
    values (dm, a, 'text', 'второй тюльпан и ещё');

  perform pg_temp.check('поиск в чате находит оба',
    (select count(*) from public.search_chat_messages(dm, 'тюльпан')) = 2);
  perform pg_temp.check('счётчик поиска', public.count_chat_search(dm, 'тюльпан') = 2);
  perform pg_temp.check('поиск в чате — свежие сверху',
    (select text from public.search_chat_messages(dm, 'тюльпан') limit 1) = 'второй тюльпан и ещё');

  perform pg_temp.act_as(d);
  perform pg_temp.check('посторонний ищет в чужом диалоге',
    (select count(*) from public.search_chat_messages(dm, 'тюльпан')) = 2);

  code := pg_temp.denied(format('select public.delete_direct_chat(%L)', dm));
  perform pg_temp.check('посторонний удаляет диалог: отказ', code = '42501', code);

  perform pg_temp.as_admin();
  insert into public.chat_members (chat_id, user_id) values (grp, d);
  perform pg_temp.act_as(d);
  code := pg_temp.denied(format('select public.delete_direct_chat(%L)', grp));
  perform pg_temp.check('участник группы удаляет группу как диалог: отказ', code = '22023', code);

  perform pg_temp.act_as(e);
  perform public.delete_direct_chat(dm);
  perform pg_temp.as_admin();
  perform pg_temp.check('чат помечен удалённым, строка осталась',
    (select deleted_at is not null from public.chats where id = dm));
  perform pg_temp.check('сообщения помечены удалёнными, строки остались',
    (select count(*) from public.messages where chat_id = dm) >= 2
    and not exists (select 1 from public.messages where chat_id = dm and deleted_at is null));

  perform pg_temp.act_as(a);
  perform pg_temp.check('удалённый диалог не ищется',
    (select count(*) from public.search_chat_messages(dm, 'тюльпан')) = 0);
  perform pg_temp.check('новый диалог с тем же человеком создаётся',
    (public.create_chat(array[e], null, null, 'Привет, это заявка') ->> 'outcome') = 'created');
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
