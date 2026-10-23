-- Приватность, этап 6: скрытый текст и задержка публикации для зрителей.
--
-- A — автор (во второй части с задержкой), B — участник, V — зритель
-- (не участник и не подписчик), S — подписчик группы, C — участник другой
-- группы, куда пересылают.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/privacy_hidden_delay_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- Рассылка нового сообщения — отложенный триггер: после отправки —
-- `set constraints all immediate`. Сигналы проверяются по строкам
-- `realtime.messages` этой же транзакции. Ход времени — сдвигом
-- `created_at` / `public_at` назад: `now()` в транзакции один.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000016a1', 'ha@test.local', '{"full_name":"Автор A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000016b1', 'hb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000016c1', 'hc@test.local', '{"full_name":"Участник C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000016d1', 'hv@test.local', '{"full_name":"Зритель V"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000016e1', 'hs@test.local', '{"full_name":"Подписчик S"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void language sql as $$
  insert into results (name, ok, detail) values (name, ok, detail);
$$;

-- Друга группа принимает сразу; не-друга — приглашением.
create function pg_temp.join(p_chat uuid) returns void language plpgsql as $$
begin
  if not exists (select 1 from public.chat_members where chat_id = p_chat and user_id = auth.uid()) then
    perform public.accept_chat_invite(p_chat);
  end if;
end;
$$;

-- Сигналы этой транзакции: сколько событий с таким сообщением ушло в топик.
create function pg_temp.signals(p_topic text, p_event text, p_message uuid default null) returns int
language sql as $$
  select count(*)::int from realtime.messages r
  where r.topic = p_topic and r.event = p_event
    and (p_message is null or r.payload ->> 'message_id' = p_message::text)
$$;

-- Защитные настройки тестовых аккаунтов здесь не проверяются: всё открыто,
-- задержка выключена — её включают ниже.
update public.privacy_settings set
  message_activity_metadata_visibility = 'everyone',
  activity_status_visibility = 'everyone',
  account_search_visibility = 'everyone',
  profile_identity_masking = 'everyone',
  dialogue_participant_name_masking = 'everyone',
  avatar_visibility = 'everyone',
  dialogue_media_visibility = 'everyone',
  public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like 'h_@test.local');

-- Участники групп дружат: приглашение не-другу — отдельная тема (этап 3).
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016b1', 'accepted', now()),
  ('00000000-0000-4000-8000-0000000016b1', '00000000-0000-4000-8000-0000000016c1', 'accepted', now());

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000016a1';
  b uuid := '00000000-0000-4000-8000-0000000016b1';
  c uuid := '00000000-0000-4000-8000-0000000016c1';
  v uuid := '00000000-0000-4000-8000-0000000016d1';
  s uuid := '00000000-0000-4000-8000-0000000016e1';
  grp uuid;
  other uuid;
  bc uuid;
  msg uuid;
  plain_msg uuid;
  fwd uuid;
  delayed uuid;
  reply uuid;
  doomed uuid;
  after_doomed uuid;
  t text;
  j jsonb;
  n int;
  ok boolean;
  ts timestamptz;
  ts2 timestamptz;
  original text := 'учусь: школа 57, класс 7Б';
begin
  perform pg_temp.act_as(a);
  grp := (public.create_chat(array[b], 'Группа скрытого') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform pg_temp.join(grp);
  other := (public.create_chat(array[c], 'Куда пересылают') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(c);
  perform pg_temp.join(other);
  perform pg_temp.act_as(s);
  perform public.subscribe_to_chat(grp);

  -- ============================================================ скрытый текст
  perform pg_temp.act_as(a);
  -- К1.1: «школа 57» — [7, 15) в code points.
  msg := public.send_media_message(grp, original, null, null, '[[7, 15]]');
  set constraints all immediate;
  set constraints all deferred;

  perform pg_temp.act_as(b);
  select r.text, r.hidden_ranges into t, j from public.message_rows r where r.id = msg;
  perform pg_temp.check('К1.1 участник видит оригинал', t = original, t);
  perform pg_temp.check('К1.1 участнику — где пометка', j = '[[7, 15]]'::jsonb, j::text);

  perform pg_temp.act_as(v);
  select r.text, r.hidden_ranges into t, j from public.message_rows r where r.id = msg;
  perform pg_temp.check('К1.3 зритель: замазка той же длины, включая пробел',
    t = 'учусь: ••••••••, класс 7Б' and char_length(t) = char_length(original), t);
  perform pg_temp.check('К1.1 зрителю — где замазка', j = '[[7, 15]]'::jsonb, j::text);
  select to_jsonb(r)::text into t from public.message_rows r where r.id = msg;
  perform pg_temp.check('К1.3 строка зрителя целиком без скрытого', position('школа' in t) = 0);

  begin
    select m.text into t from public.messages m where m.id = msg;
    perform pg_temp.check('К1.3 текст из таблицы зрителю закрыт', false, t);
  exception when insufficient_privilege then
    perform pg_temp.check('К1.3 текст из таблицы зрителю закрыт', true);
  end;

  begin
    select m.public_text into t from public.messages m where m.id = msg;
    perform pg_temp.check('текст для зрителей из таблицы тоже закрыт', false, t);
  exception when insufficient_privilege then
    perform pg_temp.check('текст для зрителей из таблицы тоже закрыт', true);
  end;

  -- К1.4: поиск
  select count(*) into n from public.search_chat_messages(grp, 'школа');
  perform pg_temp.check('К1.4 зритель не находит скрытое поиском в чате', n = 0, n::text);
  perform pg_temp.check('К1.4 и счётчик поиска — ноль', public.count_chat_search(grp, 'школа') = 0);
  select x.text into t from public.search_chat_messages(grp, 'класс') x;
  perform pg_temp.check('К1.4 зритель находит открытое, текст — с замазкой', t = 'учусь: ••••••••, класс 7Б', t);

  perform pg_temp.act_as(s);
  select count(*) into n from public.search_messages('школа');
  perform pg_temp.check('К1.4 подписчик не находит скрытое глобальным поиском', n = 0, n::text);
  select x.text into t from public.search_messages('класс') x where x.message_id = msg;
  perform pg_temp.check('К1.4 глобальный поиск — текст с замазкой', t = 'учусь: ••••••••, класс 7Б', t);
  select public.last_message_preview(ch) into t from public.chat_rows ch where ch.id = grp;
  perform pg_temp.check('К1.5 превью в «Чатах» у подписчика — с замазкой', t = 'учусь: ••••••••, класс 7Б', t);

  perform pg_temp.act_as(b);
  select count(*) into n from public.search_chat_messages(grp, 'школа');
  perform pg_temp.check('К1.4 участник находит в чате', n = 1, n::text);
  select count(*) into n from public.search_messages('школа') x where x.message_id = msg;
  perform pg_temp.check('К1.4 участник находит глобально', n = 1, n::text);
  select public.last_message_preview(ch) into t from public.chat_rows ch where ch.id = grp;
  perform pg_temp.check('превью участника — оригинал', t = original, t);

  -- К1.5: рассылки в личные топики
  perform set_config('role', 'postgres', true);
  select r.payload ->> 'text' into t from realtime.messages r
  where r.topic = 'user:' || s and r.event = 'new_message' and r.payload ->> 'message_id' = msg::text;
  perform pg_temp.check('К1.5 рассылка подписчику — с замазкой', t = 'учусь: ••••••••, класс 7Б', t);
  select r.payload ->> 'text' into t from realtime.messages r
  where r.topic = 'user:' || b and r.event = 'new_message' and r.payload ->> 'message_id' = msg::text;
  perform pg_temp.check('рассылка участнику — оригинал', t = original, t);
  select c2.last_message_text into t from public.chats c2 where c2.id = grp;
  perform pg_temp.check('chats.last_message_text — версия для зрителей', t = 'учусь: ••••••••, класс 7Б', t);

  -- К1.5: островок в другом чате — глазами участия в исходном
  perform pg_temp.act_as(b);
  fwd := public.forward_messages(other, grp, array[msg]);
  set constraints all immediate;
  set constraints all deferred;
  select r.text into t from public.message_rows r where r.id = msg;
  perform pg_temp.check('островок: B (участник исходного) видит оригинал', t = original, t);
  perform pg_temp.act_as(c);
  select o.text into t
  from public.forward_items fi join public.message_rows o on o.id = fi.message_id
  where fi.forward_id = fwd;
  perform pg_temp.check('К1.5 островок у C (участник только второго чата) — с замазкой',
    t = 'учусь: ••••••••, класс 7Б', t);

  -- К1.5, К1.6: фрагменты
  perform pg_temp.act_as(b);
  perform public.set_fragment_reaction(msg, 7, 12, 'школа', '🔥');
  perform pg_temp.act_as(v);
  select f.exact_text into t from public.list_message_fragments(msg) f where f.start_offset = 7;
  perform pg_temp.check('К1.5 якорь фрагмента участника зрителю — с замазкой', t = '•••••', t);
  select f.exact_text into t from public.fragment_rows f where f.message_id = msg and f.start_offset = 7;
  perform pg_temp.check('К1.5 цитата фрагмента (fragment_rows) — с замазкой', t = '•••••', t);
  begin
    select f.exact_text into t from public.message_fragments f where f.message_id = msg limit 1;
    perform pg_temp.check('якорь из таблицы фрагментов закрыт', false, t);
  exception when insufficient_privilege then
    perform pg_temp.check('якорь из таблицы фрагментов закрыт', true);
  end;

  begin
    perform public.set_fragment_reaction(msg, 13, 21, '••, клас', '🔥');
    perform pg_temp.check('К1.6 зритель не выделяет кусок, задевающий скрытое', false);
  exception when others then
    perform pg_temp.check('К1.6 зритель не выделяет кусок, задевающий скрытое', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.set_fragment_reaction(msg, 17, 22, 'класс', '🔥');
    perform pg_temp.check('К1.6 зритель выделяет открытое', true);
  exception when others then
    perform pg_temp.check('К1.6 зритель выделяет открытое', false, sqlerrm);
  end;

  -- К1.7: снять или скрыть в чужом нельзя
  perform pg_temp.act_as(b);
  begin
    perform public.set_message_hidden(msg, 7, 15, false);
    perform pg_temp.check('К1.7 участник не снимает скрытие в чужом', false);
  exception when others then
    perform pg_temp.check('К1.7 участник не снимает скрытие в чужом', sqlstate = '42501', sqlerrm);
  end;
  begin
    perform public.set_message_hidden(msg, 0, 5, true);
    perform pg_temp.check('К1.7 участник не скрывает в чужом', false);
  exception when others then
    perform pg_temp.check('К1.7 участник не скрывает в чужом', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.act_as(a);
  j := public.set_message_hidden(msg, 17, 22, true);
  perform pg_temp.check('К1.2 автор скрывает в отправленном', j = '[[7, 15], [17, 22]]'::jsonb, j::text);
  perform pg_temp.check('скрытие — не правка',
    (select not r.edited from public.message_rows r where r.id = msg));
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('сигнал «перечитай» после скрытия',
    pg_temp.signals('chat:' || grp, 'message_edited', msg) >= 1);
  perform pg_temp.act_as(a);
  j := public.set_message_hidden(msg, 7, 22, false);
  perform pg_temp.act_as(v);
  select r.text into t from public.message_rows r where r.id = msg;
  perform pg_temp.check('К1.7 автор снял скрытие — зритель видит оригинал', t = original, t);

  -- К1.8: правка
  perform pg_temp.act_as(a);
  perform public.set_message_hidden(msg, 7, 15, true);
  perform public.edit_message(msg, 'Итак, ' || original, '[]'::jsonb, null, '[[13, 21]]');
  perform pg_temp.act_as(v);
  select r.text, r.hidden_ranges into t, j from public.message_rows r where r.id = msg;
  perform pg_temp.check('К1.8 правка со сдвинутым скрытым', t = 'Итак, учусь: ••••••••, класс 7Б' and j = '[[13, 21]]'::jsonb, t || ' ' || j::text);
  perform pg_temp.act_as(a);
  perform public.edit_message(msg, 'Итак, ' || original, '[]'::jsonb, null, null);
  perform pg_temp.check('К1.8 без диапазонов при том же тексте — скрытое на месте',
    (select r.hidden_ranges from public.message_rows r where r.id = msg) = '[[13, 21]]'::jsonb);
  begin
    perform public.edit_message(msg, 'коротко', '[]'::jsonb, null, '[[3, 40]]');
    perform pg_temp.check('К1.8 скрытое за пределами текста — отказ', false);
  exception when others then
    perform pg_temp.check('К1.8 скрытое за пределами текста — отказ', sqlstate = '22023', sqlerrm);
  end;
  perform public.edit_message(msg, 'совсем другой текст', '[]'::jsonb, null, null);
  perform pg_temp.check('К1.8 новый текст без диапазонов — скрытое снято',
    (select r.hidden_ranges from public.message_rows r where r.id = msg) = '[]'::jsonb);

  perform set_config('role', 'postgres', true);
  begin
    update public.messages set hidden_ranges = '{[0,500)}' where id = msg;
    perform pg_temp.check('К1.8 инвариант базы: в пределах текста', false);
  exception when check_violation then
    perform pg_temp.check('К1.8 инвариант базы: в пределах текста', true);
  end;

  -- Прямая вставка текстового сообщения со скрытым.
  perform pg_temp.act_as(a);
  plain_msg := gen_random_uuid();
  insert into public.messages (id, chat_id, author_id, kind, text, hidden_ranges)
  values (plain_msg, grp, a, 'text', 'мой адрес Ленина 5', '{[10,18)}');
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.act_as(v);
  select r.text into t from public.message_rows r where r.id = plain_msg;
  perform pg_temp.check('прямая вставка со скрытым — зритель видит замазку', t = 'мой адрес ••••••••', t);
  perform pg_temp.act_as(a);
  begin
    insert into public.messages (chat_id, author_id, kind, text, hidden_ranges)
    values (grp, a, 'text', 'abc', '{[1,10)}');
    perform pg_temp.check('вставка со скрытым за текстом — отказ', false);
  exception when check_violation then
    perform pg_temp.check('вставка со скрытым за текстом — отказ', true);
  end;

  -- К1.9: без скрытого всё как раньше
  perform pg_temp.act_as(v);
  select count(*) into n from public.message_rows r where r.chat_id = grp and r.text is not null;
  perform pg_temp.check('К1.9 зритель видит сообщения группы', n >= 2, n::text);

  -- ================================================================== задержка
  perform set_config('role', 'postgres', true);
  update public.privacy_settings set public_message_visibility_delay = 'random_delay' where user_id = a;

  perform pg_temp.act_as(a);
  delayed := public.send_media_message(grp, 'отложенное сообщение', null);
  set constraints all immediate;
  set constraints all deferred;

  -- К2.3
  perform set_config('role', 'postgres', true);
  select m.public_at - m.created_at between interval '60 seconds' and interval '1800 seconds'
    and m.created_at = now()
  into ok
  from public.messages m where m.id = delayed;
  perform pg_temp.check('К2.3 публикация через 1–30 минут, created_at не тронут', ok);
  select bool_and(x between 60 and 1800), count(distinct x) > 50 into ok
  from (select public.random_publish_delay_seconds() x from generate_series(1, 300)) d;
  perform pg_temp.check('К2.3 задержка случайна и в пределах 1–30 минут', ok);

  -- К2.1
  perform pg_temp.check('К2.1 сигнал нового — в топик участников',
    pg_temp.signals('chat-members:' || grp, 'new_message', delayed) = 1);
  perform pg_temp.check('К2.1 в общий топик — ничего',
    pg_temp.signals('chat:' || grp, 'new_message', delayed) = 0);
  perform pg_temp.check('К2.1 участнику — рассылка сразу',
    pg_temp.signals('user:' || b, 'new_message', delayed) = 1);
  perform pg_temp.check('К2.1 подписчику — ничего до публикации',
    pg_temp.signals('user:' || s, 'new_message', delayed) = 0);

  perform pg_temp.act_as(b);
  perform pg_temp.check('К2.1 участник видит сразу',
    exists (select 1 from public.message_rows r where r.id = delayed));

  perform pg_temp.act_as(v);
  perform pg_temp.check('К2.1 зритель не видит в выборке',
    not exists (select 1 from public.message_rows r where r.id = delayed));
  perform pg_temp.check('К2.1 зритель не видит и номером из таблицы',
    not exists (select 1 from public.messages m where m.id = delayed));
  perform pg_temp.check('К2.1 зритель не находит поиском', public.count_chat_search(grp, 'отложенное') = 0);

  perform pg_temp.act_as(s);
  select public.last_message_preview(ch) into t from public.chat_rows ch where ch.id = grp;
  perform pg_temp.check('К2.1 превью подписчика — прежнее', t = 'мой адрес ••••••••', t);
  perform pg_temp.check('К2.1 подписчик не находит глобальным поиском',
    not exists (select 1 from public.search_messages('отложенное')));

  -- К2.2: ответ B после неопубликованного тоже ждёт
  perform pg_temp.act_as(b);
  reply := public.send_media_message(grp, 'ответ участника', null);
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.act_as(v);
  perform pg_temp.check('К2.2 ответ B зрителю не виден',
    not exists (select 1 from public.message_rows r where r.id = reply));
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('К2.2 о ответе B — только участникам',
    pg_temp.signals('chat:' || grp, 'new_message', reply) = 0
    and pg_temp.signals('chat-members:' || grp, 'new_message', reply) = 1);

  -- К2.5: реакция и закреп на неопубликованном
  perform pg_temp.act_as(b);
  perform public.set_reaction('message', delayed, '🔥');
  perform public.pin_message(delayed, null);
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('К2.5 реакция — только участникам',
    pg_temp.signals('chat:' || grp, 'reactions_changed', delayed) = 0
    and pg_temp.signals('chat-members:' || grp, 'reactions_changed', delayed) = 1);
  perform pg_temp.check('К2.5 закреп — только участникам',
    (select count(*) from realtime.messages r where r.topic = 'chat:' || grp and r.event = 'pins_changed') = 0
    and (select count(*) from realtime.messages r where r.topic = 'chat-members:' || grp and r.event = 'pins_changed') = 1);
  perform pg_temp.act_as(v);
  perform pg_temp.check('К2.5 закреп-полоса у зрителя не меняется',
    not exists (select 1 from public.message_pins p where p.chat_id = grp));

  -- К2.5: комментарий участника к неопубликованному и цитата — тоже только участникам
  perform pg_temp.act_as(b);
  perform public.send_comment(delayed, 'комментарий к неопубликованному');
  perform pg_temp.act_as(v);
  perform pg_temp.check('К2.5 комментарий к неопубликованному зрителю не виден (таблица и comment_rows)',
    not exists (select 1 from public.comments c where c.message_id = delayed)
    and not exists (select 1 from public.comment_rows c where c.message_id = delayed));
  perform pg_temp.check('К2.5 реакция на неопубликованное зрителю не видна (reactor_rows)',
    not exists (select 1 from public.reactor_rows r where r.target_id = delayed));
  perform pg_temp.check('К2.2 цитаты ответа на неопубликованное зрителю не видны',
    not exists (select 1 from public.message_replies r where r.quoted_id = delayed or r.message_id = delayed));

  -- К2.6
  perform pg_temp.act_as(b);
  t := public.my_typing_audience(grp);
  perform pg_temp.check('К2.6 «печатает» в чате с задержкой — не в общий топик', t <> 'chat', t);

  -- К2.7: островок с неопубликованным
  fwd := public.forward_messages(other, grp, array[delayed]);
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.act_as(c);
  perform pg_temp.check('К2.7 островок в другом чате — без неопубликованного оригинала',
    not exists (select 1 from public.forward_items fi where fi.forward_id = fwd));

  -- Фрагмент зрителя на неопубликованном
  perform pg_temp.act_as(v);
  begin
    perform public.set_fragment_reaction(delayed, 0, 10, 'отложенное', '🔥');
    perform pg_temp.check('зритель не выделяет в неопубликованном', false);
  exception when others then
    perform pg_temp.check('зритель не выделяет в неопубликованном', sqlstate = 'P0002', sqlerrm);
  end;

  -- Публикация: прошло 40 минут
  perform set_config('role', 'postgres', true);
  update public.messages
  set created_at = created_at - interval '40 minutes',
      public_at = public_at - interval '40 minutes',
      delayed_until = delayed_until - interval '40 minutes'
  where id in (delayed, reply);
  perform public.release_public_messages();

  perform pg_temp.check('К2.2 публикация: сигнал в общий топик',
    pg_temp.signals('chat:' || grp, 'new_message') >= 1);
  perform pg_temp.check('К2.2 подписчику — уведомление в момент публикации',
    pg_temp.signals('user:' || s, 'new_message', delayed) = 1
    and pg_temp.signals('user:' || s, 'new_message', reply) = 1);
  perform pg_temp.check('водораздел снят', (select public_hold_seq from public.chats where id = grp) is null);

  perform pg_temp.act_as(v);
  select array_agg(r.id order by r.seq)::text into t
  from public.message_rows r where r.id in (delayed, reply);
  perform pg_temp.check('К2.2 после публикации оба видны в правильном порядке',
    t = array[delayed, reply]::text, t);
  perform pg_temp.check('К2.5 закреп виден после публикации',
    exists (select 1 from public.message_pins p where p.chat_id = grp));
  perform pg_temp.check('К2.7 островок показывает оригинал после публикации',
    exists (select 1 from public.forward_items fi where fi.forward_id = fwd));

  -- К2.8: время зрителя — время публикации
  select r.created_at into ts from public.message_rows r where r.id = delayed;
  perform set_config('role', 'postgres', true);
  select m.public_at into ts2 from public.messages m where m.id = delayed;
  perform pg_temp.check('К2.8 открытое время зрителя — время публикации', ts = ts2, ts::text);
  perform pg_temp.act_as(b);
  select r.created_at into ts from public.message_rows r where r.id = delayed;
  perform pg_temp.check('участник видит время создания', ts = now() - interval '40 minutes', ts::text);
  perform set_config('role', 'postgres', true);
  update public.privacy_settings set message_activity_metadata_visibility = 'nobody' where user_id = b;
  update public.chats set time_restricted = true where id = grp;
  perform pg_temp.act_as(v);
  select r.created_at into ts from public.message_rows r where r.id = delayed;
  perform pg_temp.check('К2.8 при скрытом времени — нет времени', ts is null);
  perform set_config('role', 'postgres', true);
  update public.privacy_settings set message_activity_metadata_visibility = 'everyone' where user_id = b;

  -- К2.4: удалённое до публикации не держит водораздел
  perform pg_temp.act_as(a);
  doomed := public.send_media_message(grp, 'передумал', null);
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.act_as(b);
  after_doomed := public.send_media_message(grp, 'после передумал', null);
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.act_as(v);
  perform pg_temp.check('К2.4 до удаления ответ ждёт',
    not exists (select 1 from public.message_rows r where r.id = after_doomed));
  perform pg_temp.act_as(a);
  perform public.delete_messages(array[doomed]);
  perform pg_temp.act_as(v);
  perform pg_temp.check('К2.4 удалённое зритель не видит',
    not exists (select 1 from public.message_rows r where r.id = doomed));
  perform pg_temp.check('К2.4 водораздел не застрял — ответ виден сразу',
    exists (select 1 from public.message_rows r where r.id = after_doomed));
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('К2.4 об удалённом неопубликованном — ничего в общий топик',
    not exists (
      select 1 from realtime.messages r
      where r.topic = 'chat:' || grp and r.event = 'messages_deleted'
        and r.payload -> 'message_ids' ? doomed::text
    ));
  perform pg_temp.check('К2.4 подписчик не получил удалённое',
    pg_temp.signals('user:' || s, 'new_message', doomed) = 0
    and pg_temp.signals('user:' || s, 'new_message', after_doomed) = 1);

  -- Заявка на диалог от владельца с задержкой не задерживается: её видят двое
  perform pg_temp.act_as(a);
  j := public.create_chat(array[v], null, null, 'заявка с задержкой');
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.act_as(v);
  perform pg_temp.check('заявка на диалог не задерживается — получатель видит её сразу',
    exists (select 1 from public.message_rows r where r.chat_id = (j ->> 'chat_id')::uuid and r.text = 'заявка с задержкой'),
    j::text);

  -- К2.9: чат без задержки
  perform pg_temp.act_as(b);
  bc := (public.create_chat(array[c], 'Без задержки') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(c);
  perform pg_temp.join(bc);
  perform public.send_media_message(bc, 'раз', null);
  perform public.send_media_message(bc, 'два', null);
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.act_as(v);
  select string_agg(r.text, ',' order by r.seq) into t from public.message_rows r where r.chat_id = bc and r.kind = 'text';
  perform pg_temp.check('К2.9 без задержки зритель видит сразу и по порядку', t = 'раз,два', t);
  perform pg_temp.act_as(c);
  t := public.my_typing_audience(bc);
  perform pg_temp.check('К2.9 «печатает» в чате без задержки — в общий топик', t = 'chat', t);

  -- Чат постов канала не задерживается никогда
  perform pg_temp.act_as(a);
  j := public.create_channel('Канал A', 'hidden_delay_chan_zz', null, null);
  perform public.send_media_message((j ->> 'chat_id')::uuid, 'пост', null);
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('пост канала не задерживается',
    (select m.public_at = m.created_at from public.messages m
     where m.chat_id = (j ->> 'chat_id')::uuid and m.text = 'пост'));
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
