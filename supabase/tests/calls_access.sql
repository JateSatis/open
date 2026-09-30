-- Звонки: кто может начать, кто говорит, кто слушает, когда звонок кончается
-- и что вебхук LiveKit не может сломать.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/calls_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- Функции вебхука вызываются здесь напрямую сервисной ролью: подпись LiveKit
-- проверяет Edge Function до них (Deno-тесты `livekit-webhook`).

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a7', 'sa@test.local', '{"full_name":"Хост A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b7', 'sb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c7', 'sc@test.local', '{"full_name":"Приглашённый C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d7', 'sd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

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
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end;
$$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

create function pg_temp.events(topic_name text, event_name text) returns int language sql as $$
  select count(*)::int from realtime.messages where topic = topic_name and event = event_name
$$;

create function pg_temp.room(stream uuid) returns text language sql as $$
  select 'stream-' || stream::text
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a7';
  b uuid := '00000000-0000-4000-8000-0000000000b7';
  c uuid := '00000000-0000-4000-8000-0000000000c7';
  d uuid := '00000000-0000-4000-8000-0000000000d7';
  chat uuid;
  chat2 uuid;
  st uuid;
  st2 uuid;
  r jsonb;
  s text;
  n int;
  m uuid;
  t0 timestamptz := now();
begin
  -- ------------------------------------------------------------- подготовка
  -- A позвал B и C; B принял, C нет — C не участник. D посторонний.
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b, c], 'Звонилка') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);

  -- ======================================================= начать звонок
  perform pg_temp.act_as(d);
  begin
    perform public.start_call(chat);
    perform pg_temp.check('посторонний не начинает звонок', false, 'прошло');
  exception when others then
    perform pg_temp.check('посторонний не начинает звонок', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(c);
  begin
    perform public.start_call(chat);
    perform pg_temp.check('приглашённый, не принявший заявку, не начинает звонок', false, 'прошло');
  exception when others then
    perform pg_temp.check('приглашённый, не принявший заявку, не начинает звонок', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as_anon();
  begin
    perform public.start_call(chat);
    perform pg_temp.check('без входа звонок не начать', false, 'прошло');
  exception when others then
    perform pg_temp.check('без входа звонок не начать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(a);
  r := public.start_call(chat);
  st := (r ->> 'stream_id')::uuid;
  perform pg_temp.check('участник начинает звонок', (r ->> 'created')::boolean and st is not null, r::text);

  perform pg_temp.act_as(b);
  r := public.start_call(chat);
  perform pg_temp.check('второе нажатие ведёт в тот же звонок, а не создаёт новый',
    (r ->> 'stream_id')::uuid = st and not (r ->> 'created')::boolean, r::text);

  select count(*) into n from public.streams where chat_id = chat and status = 'live';
  perform pg_temp.check('в чате один живой звонок', n = 1, n::text);

  perform pg_temp.act_as(a);
  begin
    insert into public.streams (chat_id, host_id, room_name) values (chat, a, 'x');
    perform pg_temp.check('клиент не вставляет звонок напрямую', false, 'прошло');
  exception when others then
    perform pg_temp.check('клиент не вставляет звонок напрямую', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.streams set status = 'ended', ended_at = now(), end_reason = 'abandoned' where id = st;
    get diagnostics n = row_count;
    perform pg_temp.check('клиент не завершает звонок напрямую', n = 0, n::text);
  exception when others then
    perform pg_temp.check('клиент не завершает звонок напрямую', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.as_owner();
  begin
    st2 := gen_random_uuid();
    insert into public.streams (id, chat_id, host_id, room_name) values (st2, chat, a, 'stream-' || st2);
    perform pg_temp.check('второй живой звонок в чате запрещён схемой', false, 'прошло');
  exception when others then
    perform pg_temp.check('второй живой звонок в чате запрещён схемой', sqlstate = '23505', sqlstate || ' ' || sqlerrm);
  end;

  -- ============================================ сообщение и входящие
  select id, author_id::text || '/' || text into m, s
  from public.messages where stream_id = st and system_event = 'call_started';
  perform pg_temp.check('в переписке «Звонок начат» от начавшего', s = a::text || '/Звонок начат', s);

  -- Превью пишет рассылка нового сообщения — отложенный триггер: запускаем.
  set constraints all immediate;
  set constraints all deferred;
  select last_message_text into s from public.chats where id = chat;
  perform pg_temp.check('превью чата — «📞 Звонок»', s = '📞 Звонок', s);

  perform pg_temp.check('входящий приходит участнику B', pg_temp.events('user:' || b, 'incoming_call') = 1);
  perform pg_temp.check('входящего нет у начавшего', pg_temp.events('user:' || a, 'incoming_call') = 0);
  perform pg_temp.check('входящего нет у не принявшего заявку', pg_temp.events('user:' || c, 'incoming_call') = 0);
  perform pg_temp.check('входящего нет у постороннего', pg_temp.events('user:' || d, 'incoming_call') = 0);
  perform pg_temp.check('начало звонка — событие в топик чата', pg_temp.events('chat:' || chat, 'stream_changed') >= 1);

  perform pg_temp.act_as(a);
  begin
    perform public.delete_messages(array[m]);
    perform pg_temp.check('«Звонок начат» не удаляет даже начавший', false, 'прошло');
  exception when others then
    perform pg_temp.check('«Звонок начат» не удаляет даже начавший', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(b);
  begin
    perform public.send_media_message(chat, 'ответ на звонок', '[]'::jsonb, array[m]);
    perform pg_temp.check('на системное сообщение не ответить', false, 'прошло');
  exception when others then
    perform pg_temp.check('на системное сообщение не ответить', sqlstate in ('22023', 'P0001', '23514'), sqlstate || ' ' || sqlerrm);
  end;

  -- ======================================================= роли в токене
  perform pg_temp.as_service();
  perform pg_temp.check('начавший — host', public.stream_join_info(st, a) ->> 'role' = 'host');
  perform pg_temp.check('участник — speaker', public.stream_join_info(st, b) ->> 'role' = 'speaker');
  perform pg_temp.check('приглашённый, не принявший — listener', public.stream_join_info(st, c) ->> 'role' = 'listener');
  perform pg_temp.check('посторонний — listener', public.stream_join_info(st, d) ->> 'role' = 'listener');
  perform pg_temp.check('неизвестный звонок — found = false',
    not (public.stream_join_info(gen_random_uuid(), a) ->> 'found')::boolean);

  -- ============================================ служебное закрыто
  perform pg_temp.act_as(a);
  begin
    perform public.stream_participant_left(pg_temp.room(st), b::text, 'x', now());
    perform pg_temp.check('клиент не вызывает функции вебхука', false, 'прошло');
  exception when others then
    perform pg_temp.check('клиент не вызывает функции вебхука', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.finish_stream(st, 'abandoned');
    perform pg_temp.check('клиент не завершает звонок функцией', false, 'прошло');
  exception when others then
    perform pg_temp.check('клиент не завершает звонок функцией', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.stream_join_info(st, a);
    perform pg_temp.check('клиент не читает данные для токена', false, 'прошло');
  exception when others then
    perform pg_temp.check('клиент не читает данные для токена', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- ================================================= вебхук: состав
  perform pg_temp.as_service();
  perform public.stream_participant_joined(pg_temp.room(st), d::text, 'PA_d1', 'listener', t0 + interval '1 s');
  s := public.stream_participant_left(pg_temp.room(st), d::text, 'PA_d1', t0 + interval '2 s');
  select status into s from public.streams where id = st;
  perform pg_temp.check('ушёл слушатель до входа говорящих — звонок идёт', s = 'live', s);

  perform public.stream_participant_joined(pg_temp.room(st), a::text, 'PA_a1', 'host', t0 + interval '3 s');
  perform public.stream_participant_joined(pg_temp.room(st), b::text, 'PA_b1', 'speaker', t0 + interval '4 s');
  perform public.stream_participant_joined(pg_temp.room(st), d::text, 'PA_d2', 'listener', t0 + interval '5 s');
  perform public.stream_participant_joined(pg_temp.room(st), c::text, 'PA_c1', 'listener', t0 + interval '5 s');

  select speakers_count || '/' || listeners_count into s from public.streams where id = st;
  perform pg_temp.check('счётчики: 2 говорят, 2 слушают', s = '2/2', s);

  -- Переподключение: новый sid пришёл раньше, чем выход старого.
  perform public.stream_participant_joined(pg_temp.room(st), b::text, 'PA_b2', 'speaker', t0 + interval '6 s');
  s := public.stream_participant_left(pg_temp.room(st), b::text, 'PA_b1', t0 + interval '7 s');
  select count(*) into n from public.stream_participants where stream_id = st and user_id = b and left_at is null;
  perform pg_temp.check('выход старого подключения не выкидывает переподключившегося', n = 1 and s = 'ok', s);

  -- Старое событие не перетирает новое.
  s := public.stream_participant_left(pg_temp.room(st), b::text, 'PA_b2', t0 + interval '5 s');
  select count(*) into n from public.stream_participants where stream_id = st and user_id = b and left_at is null;
  perform pg_temp.check('запоздавший выход не перетирает вход', n = 1, s);

  s := public.stream_participant_left(pg_temp.room(st), a::text, 'PA_a1', t0 + interval '8 s');
  select status into s from public.streams where id = st;
  perform pg_temp.check('ушёл один участник, другой остался — звонок идёт', s = 'live', s);

  perform public.stream_participant_left(pg_temp.room(st), c::text, 'PA_c1', t0 + interval '9 s');
  select status into s from public.streams where id = st;
  perform pg_temp.check('ушёл слушатель — звонок идёт', s = 'live', s);

  s := public.stream_participant_left(pg_temp.room(st), b::text, 'PA_b2', t0 + interval '10 s');
  perform pg_temp.check('последний участник вышел — вебхуку велено закрыть комнату', s = 'finished', s);

  select status || '/' || end_reason || '/' || speakers_count || '/' || listeners_count into s
  from public.streams where id = st;
  perform pg_temp.check('звонок завершён, хотя слушатель D ещё был', s = 'ended/everyone_left/0/0', s);

  select count(*) into n from public.stream_participants where stream_id = st and left_at is null;
  perform pg_temp.check('после конца в звонке никого', n = 0, n::text);

  select text into s from public.messages where stream_id = st and system_event = 'call_ended';
  perform pg_temp.check('в переписке «Звонок завершён · …»', s like 'Звонок завершён · %', s);

  perform pg_temp.check('участникам чата — сигнал о конце звонка',
    pg_temp.events('user:' || a, 'stream_ended') = 1 and pg_temp.events('user:' || b, 'stream_ended') = 1);

  -- Повторы и поздние события.
  s := public.stream_room_finished(pg_temp.room(st));
  select count(*) into n from public.messages where stream_id = st and system_event = 'call_ended';
  perform pg_temp.check('повторный конец не дописывает второе сообщение', n = 1 and s = 'ended', s);

  s := public.stream_participant_joined(pg_temp.room(st), b::text, 'PA_b3', 'speaker', t0 + interval '20 s');
  select count(*) into n from public.stream_participants where stream_id = st and left_at is null;
  perform pg_temp.check('вход в завершённый звонок — «закрыть комнату», в базе никого', s = 'ended' and n = 0, s);

  s := public.stream_participant_joined('stream-' || gen_random_uuid(), b::text, 'x', 'speaker', now());
  perform pg_temp.check('неизвестная комната — ended', s = 'ended', s);

  select status into s from public.streams where id = st;
  perform pg_temp.act_as(d);
  select count(*) into n from public.streams where id = st;
  perform pg_temp.check('посторонний видит звонок (эфир публичен)', n = 1, n::text);
  select count(*) into n from public.stream_participants where stream_id = st;
  perform pg_temp.check('посторонний видит состав эфира', n = 4, n::text);

  perform pg_temp.act_as(b);
  select count(*) into n from public.messages m2, lateral public.my_stream_participation(m2) p
  where m2.stream_id = st;
  perform pg_temp.check('участник видит, что был в звонке', n = 2, n::text);

  -- ============================================ зависшие звонки
  perform pg_temp.act_as(a);
  st2 := (public.start_call(chat) ->> 'stream_id')::uuid;
  perform pg_temp.check('после конца можно начать новый звонок', st2 is not null and st2 <> st);

  perform pg_temp.as_service();
  s := public.reconcile_stream(pg_temp.room(st2), '[]'::jsonb);
  select status into s from public.streams where id = st2;
  perform pg_temp.check('сверка не хоронит свежий звонок, куда создатель ещё входит', s = 'live', s);

  s := public.reconcile_stream(pg_temp.room(st2),
    jsonb_build_array(jsonb_build_object('identity', a, 'sid', 'PA_r1', 'role', 'host'),
                      jsonb_build_object('identity', d, 'sid', 'PA_r2', 'role', 'listener')));
  select speakers_count || '/' || listeners_count into s from public.streams where id = st2;
  perform pg_temp.check('сверка дописывает пропущенные входы', s = '1/1', s);

  perform pg_temp.as_owner();
  update public.streams set started_at = now() - interval '5 minutes' where id = st2;
  perform pg_temp.as_service();
  s := public.reconcile_stream(pg_temp.room(st2),
    jsonb_build_array(jsonb_build_object('identity', d, 'sid', 'PA_r2', 'role', 'listener')));
  select status || '/' || end_reason into s from public.streams where id = st2;
  perform pg_temp.check('сверка: в LiveKit остались только слушатели — звонок завершён', s = 'ended/reconciled', s);

  -- Брошенный звонок: никто так и не вошёл.
  perform pg_temp.act_as(b);
  st2 := (public.start_call(chat) ->> 'stream_id')::uuid;
  perform pg_temp.as_owner();
  update public.streams set speakers_changed_at = now() - interval '3 minutes' where id = st2;
  perform pg_temp.as_service();
  n := public.finish_abandoned_streams();
  select status || '/' || end_reason into s from public.streams where id = st2;
  perform pg_temp.check('pg_cron завершает звонок без говорящих дольше 2 минут', s = 'ended/abandoned', s);

  perform pg_temp.act_as(a);
  st2 := (public.start_call(chat) ->> 'stream_id')::uuid;
  perform pg_temp.as_service();
  n := public.finish_abandoned_streams();
  select status into s from public.streams where id = st2;
  perform pg_temp.check('свежий звонок pg_cron не трогает', s = 'live', s);

  -- ================================================================ без входа
  perform pg_temp.act_as_anon();
  begin
    select count(*) into n from public.streams;
    perform pg_temp.check('без входа звонки не читаются', n = 0, n::text);
  exception when others then
    perform pg_temp.check('без входа звонки не читаются', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
end;
$$;

reset role;
insert into results (name, ok, detail)
select 'pg_cron раз в минуту завершает брошенные звонки', count(*) = 1, string_agg(schedule, ',')
from cron.job where jobname = 'finish-abandoned-streams' and schedule = '* * * * *';

select n, ok, name, detail from results order by n;

rollback;
