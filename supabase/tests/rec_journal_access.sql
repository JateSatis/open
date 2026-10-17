-- Журнал рекомендаций (этап 1): доступ к таблицам, партиции, валентность,
-- приём событий клиента — дедуп, отказы с причиной, лимиты, потерянный показ.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/rec_journal_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000007a1', 'ra@test.local', '{"full_name":"Автор канала"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000007b1', 'rb@test.local', '{"full_name":"Зритель B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000007c1', 'rc@test.local', '{"full_name":"Зритель C"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

create function pg_temp.refused(name text, sql text, code text) returns void
language plpgsql as $$
begin
  execute sql;
  perform pg_temp.check(name, false, 'прошло');
exception when others then
  perform pg_temp.check(name, sqlstate = code, sqlstate || ' ' || sqlerrm);
end;
$$;

create function pg_temp.ms(t timestamptz) returns bigint
language sql as $$ select (extract(epoch from t) * 1000)::bigint $$;

/** Событие клиента. */
create function pg_temp.ev(
  kind text, id uuid, at timestamptz, impression uuid default null, subject_type text default null,
  subject_id uuid default null, surface text default null, data jsonb default '{}'::jsonb
) returns jsonb
language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', id, 'kind', kind, 'v', 1, 'ts', pg_temp.ms(at), 'impression_id', impression,
    'subject_type', subject_type, 'subject_id', subject_id, 'surface', surface
  )) || jsonb_build_object('data', data)
$$;

create function pg_temp.send(events jsonb) returns jsonb
language sql as $$
  select public.rec_record_events(jsonb_build_object('sent_at', pg_temp.ms(now()), 'events', events))
$$;

create function pg_temp.reason(result jsonb, id uuid) returns text
language sql as $$
  select r ->> 'reason' from jsonb_array_elements(result -> 'rejected') r where r ->> 'id' = id::text
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000007a1';
  b uuid := '00000000-0000-4000-8000-0000000007b1';
  c uuid := '00000000-0000-4000-8000-0000000007c1';
  video jsonb := '{"url":"r1/pops/v.mp4","poster_url":"r1/pops/p.jpg","mime_type":"video/mp4","width":720,"height":1280,"duration_ms":5000}';
  r jsonb;
  chan uuid;
  pop uuid := gen_random_uuid();
  imp uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid();
  e2 uuid := gen_random_uuid();
  e3 uuid := gen_random_uuid();
  x uuid;
  batch jsonb;
  res1 jsonb;
  res2 jsonb;
  t text;
  n int;
  big jsonb;
  today_part text := 'rec_events_p' || to_char((now() at time zone 'UTC')::date, 'YYYYMMDD');
begin
  perform pg_temp.act_as(a);
  r := public.create_channel('Журнал', 'rec_journal_zz');
  chan := (r ->> 'channel_id')::uuid;
  perform public.publish_pop(chan, pop, video, 'Поп журнала', null, false, null, null);

  -- ===================================================== К1.1 — всё закрыто
  perform pg_temp.act_as(b);

  foreach t in array array[
    'public.rec_config', 'public.rec_events', 'rec_parts.rec_events_default', 'rec_parts.' || today_part,
    'public.rec_event_keys', 'public.rec_reject_counts', 'public.rec_impressions', 'public.rec_pop_stats',
    'public.rec_pop_hourly', 'public.rec_pop_heat', 'public.rec_pop_viewers', 'public.rec_app_sessions',
    'public.rec_rollup_state'
  ] loop
    perform pg_temp.refused('К1.1 ' || t || ': чтение — отказ', format('select count(*) from %s', t), '42501');
    perform pg_temp.refused('К1.1 ' || t || ': вставка — отказ', format('insert into %s default values', t), '42501');
  end loop;

  perform pg_temp.refused('К1.1 свёртка недоступна клиенту', 'select public.rec_rollup()', '42501');
  perform pg_temp.refused('К1.1 уборка партиций недоступна клиенту', 'select public.rec_partitions_maintain()', '42501');
  perform pg_temp.refused('К1.1 rec_log недоступен клиенту',
    format('select public.rec_log(%L, %L, null, null, %L)', b, 'reaction_set', '{}'), '42501');

  -- Скрытие: своё видно, чужое — нет, писать напрямую нельзя.
  perform public.set_pop_not_interested(pop, true);
  perform public.set_channel_hidden(chan, true, pop);
  perform pg_temp.act_as(c);
  perform public.set_pop_not_interested(pop, true);

  perform pg_temp.check('К1.1 свои строки «не интересно» видны, чужие — нет',
    (select count(*) from public.rec_hidden_pops) = 1
      and (select user_id from public.rec_hidden_pops) = c);
  perform pg_temp.check('К1.1 чужой скрытый канал не виден',
    not exists (select 1 from public.rec_hidden_channels));
  perform pg_temp.refused('К1.1 вставка в rec_hidden_pops напрямую — отказ',
    format('insert into public.rec_hidden_pops (user_id, pop_id) values (%L, %L)', c, pop), '42501');
  perform pg_temp.refused('К1.1 удаление из rec_hidden_channels напрямую — отказ',
    'delete from public.rec_hidden_channels', '42501');

  perform pg_temp.act_as(b);
  perform pg_temp.check('К1.1 свой скрытый канал виден',
    (select count(*) from public.rec_hidden_channels where user_id = b and channel_id = chan and from_pop_id = pop) = 1);

  -- Подписка снимает скрытие канала; «Показывать в ленте» — тоже.
  perform public.subscribe_to_channel(chan, false);
  perform pg_temp.check('скрытие канала снято подпиской', not exists (select 1 from public.rec_hidden_channels));
  perform public.unsubscribe_from_channel(chan);
  perform public.set_channel_hidden(chan, true);
  perform public.set_channel_hidden(chan, false);
  perform public.set_pop_not_interested(pop, false);
  perform pg_temp.check('скрытие канала и «не интересно» снимаются функциями',
    not exists (select 1 from public.rec_hidden_channels) and not exists (select 1 from public.rec_hidden_pops));

  -- ============================================== К1.2 — партиции по дням
  perform pg_temp.as_service();
  perform pg_temp.check('К1.2 партиции — в закрытой схеме, не в public',
    not exists (select 1 from pg_inherits i join pg_class c on c.oid = i.inhrelid
                where i.inhparent = 'public.rec_events'::regclass and c.relnamespace = 'public'::regnamespace)
      and not has_schema_privilege('authenticated', 'rec_parts', 'usage'));
  perform pg_temp.check('К1.2 партиции на сегодня и неделю вперёд есть',
    (select count(*) from generate_series(0, 7) d
     where to_regclass('rec_parts.rec_events_p' || to_char((now() at time zone 'UTC')::date + d, 'YYYYMMDD')) is not null) = 8);

  -- Событие без своей партиции не теряется: ляжет в партицию по умолчанию и
  -- переедет, когда партиция появится.
  insert into public.rec_events (user_id, origin, kind, server_ts, event_ts)
  values (b, 'server', 'reaction_set', now() + interval '30 days', now());
  perform pg_temp.check('К1.2 событие за горизонтом — в партиции по умолчанию',
    (select count(*) from rec_parts.rec_events_default where user_id = b) = 1);

  r := public.rec_partitions_maintain(now() + interval '25 days');
  perform pg_temp.check('К1.2 уборка создаёт партиции вперёд и переносит строки из партиции по умолчанию',
    to_regclass('rec_parts.rec_events_p' || to_char((now() at time zone 'UTC')::date + 30, 'YYYYMMDD')) is not null
      and (select count(*) from rec_parts.rec_events_default where user_id = b) = 0
      and (select count(*) from public.rec_events where user_id = b and server_ts > now() + interval '29 days') = 1,
    r::text);
  perform pg_temp.check('К1.2 новая партиция закрыта для клиента',
    not has_table_privilege('authenticated',
      'rec_parts.rec_events_p' || to_char((now() at time zone 'UTC')::date + 30, 'YYYYMMDD'), 'select')
      and (select relrowsecurity from pg_class
           where oid = ('rec_parts.rec_events_p' || to_char((now() at time zone 'UTC')::date + 30, 'YYYYMMDD'))::regclass));

  r := public.rec_partitions_maintain(now() + interval '25 days');
  perform pg_temp.check('К1.2 повторная уборка ничего не меняет',
    jsonb_array_length(r -> 'created') = 0 and jsonb_array_length(r -> 'dropped') = 0, r::text);

  r := public.rec_partitions_maintain(now() + interval '95 days');
  perform pg_temp.check('К1.2 партиции старше ретенции (90 дней) удаляются',
    to_regclass('rec_parts.' || today_part) is null
      and to_regclass('rec_parts.rec_events_p' || to_char((now() at time zone 'UTC')::date + 30, 'YYYYMMDD')) is not null
      and r -> 'dropped' ? today_part,
    r::text);

  -- Сегодняшняя партиция нужна дальше — вернуть её.
  r := public.rec_partitions_maintain(now());

  -- ================================================ К1.3 — валентность
  perform pg_temp.check('К1.3 у каждой реакции есть валентность в [−1, 1]',
    not exists (select 1 from public.reaction_emojis where valence is null or valence not between -1 and 1)
      and (select valence from public.reaction_emojis where emoji = '❤️') > 0
      and (select valence from public.reaction_emojis where emoji = '🤮') < 0);

  -- ================================================== К2.1 — дедуп пачки
  perform pg_temp.act_as(b);
  batch := jsonb_build_array(
    pg_temp.ev('impression_start', e1, now() - interval '10 seconds', imp, 'pop', pop, 'channel',
      '{"entry":"channel_grid","volume":0.5,"muted":false,"route":"speaker","network":"wifi"}'),
    pg_temp.ev('impression_progress', e2, now() - interval '5 seconds', imp, null, null, null,
      '{"visible_ms":5000,"watch_ms":4800,"max_pos_ms":4800,"coverage":31,"loops":0}'),
    pg_temp.ev('impression_end', e3, now(), imp, null, null, null,
      '{"visible_ms":10000,"watch_ms":9500,"max_pos_ms":5000,"coverage":31,"loops":1,"exit":"swipe_next"}')
  );
  res1 := pg_temp.send(batch);
  res2 := pg_temp.send(batch);

  perform pg_temp.as_service();
  perform pg_temp.check('К2.1 пачка дважды — три строки',
    (select count(*) from public.rec_events where impression_id = imp) = 3);
  perform pg_temp.check('К2.1 оба раза все три приняты',
    jsonb_array_length(res1 -> 'accepted') = 3 and jsonb_array_length(res1 -> 'rejected') = 0
      and jsonb_array_length(res2 -> 'accepted') = 3 and jsonb_array_length(res2 -> 'rejected') = 0,
    res1::text || ' / ' || res2::text);
  perform pg_temp.check('К2.1 повтор учтён как дубль',
    (select count from public.rec_reject_counts where reason = 'duplicate' and day = (now() at time zone 'UTC')::date) >= 3);
  perform pg_temp.check('К2.1 снимок показа получил объект из начала',
    (select bool_and(subject_id = pop and user_id = b and origin = 'client') from public.rec_events where impression_id = imp));

  -- ============================================== К2.2 — отказы с причиной
  perform pg_temp.act_as(b);
  x := gen_random_uuid();
  res1 := pg_temp.send(jsonb_build_array(
    pg_temp.ev('impression_start', x, now(), gen_random_uuid(), 'pop', pop, 'channel') || jsonb_build_object('user_id', c)
  ));
  perform pg_temp.check('К2.2 чужой user_id — foreign_user', pg_temp.reason(res1, x) = 'foreign_user', res1::text);

  x := gen_random_uuid();
  res1 := pg_temp.send(jsonb_build_array(pg_temp.ev('pop_liked_secretly', x, now())));
  perform pg_temp.check('К2.2 неизвестный kind — unknown_kind', pg_temp.reason(res1, x) = 'unknown_kind', res1::text);

  x := gen_random_uuid();
  res1 := pg_temp.send(jsonb_build_array(pg_temp.ev('impression_progress', x, now(), imp, null, null, null,
    '{"visible_ms":10000,"watch_ms":15000,"loops":0}')));
  perform pg_temp.check('К2.2 watch больше длины × (круги + 1) — implausible', pg_temp.reason(res1, x) = 'implausible', res1::text);

  x := gen_random_uuid();
  res1 := pg_temp.send(jsonb_build_array(pg_temp.ev('impression_progress', x, now(), imp, null, null, null,
    '{"visible_ms":10000,"watch_ms":14000,"loops":5}')));
  perform pg_temp.check('К2.2 watch больше реального времени показа — implausible', pg_temp.reason(res1, x) = 'implausible', res1::text);

  x := gen_random_uuid();
  res1 := pg_temp.send(jsonb_build_array(pg_temp.ev('impression_end', x, now(), imp, null, null, null,
    '{"visible_ms":9000,"watch_ms":4000,"max_pos_ms":4000,"exit":"swipe_next","seeks":[{"from":1000,"to":90000}]}')));
  perform pg_temp.check('К2.2 перемотка за длину попа — implausible', pg_temp.reason(res1, x) = 'implausible', res1::text);

  x := gen_random_uuid();
  res1 := pg_temp.send(jsonb_build_array(pg_temp.ev('impression_end', x, now(), gen_random_uuid(), null, null, null,
    '{"visible_ms":1000,"watch_ms":900,"exit":"swipe_next"}')));
  perform pg_temp.check('К2.2 конец без начала — no_start', pg_temp.reason(res1, x) = 'no_start', res1::text);

  x := gen_random_uuid();
  res1 := pg_temp.send(jsonb_build_array(pg_temp.ev('impression_end', x, now(), imp, null, null, null,
    '{"visible_ms":1000,"watch_ms":900,"exit":"teleported"}')));
  perform pg_temp.check('К2.2 неизвестная причина выхода — bad_shape', pg_temp.reason(res1, x) = 'bad_shape', res1::text);

  x := gen_random_uuid();
  res1 := pg_temp.send(jsonb_build_array(pg_temp.ev('impression_start', x, now(), gen_random_uuid(), 'pop', gen_random_uuid(), 'channel')));
  perform pg_temp.check('К2.2 показ несуществующего попа — unknown_subject', pg_temp.reason(res1, x) = 'unknown_subject', res1::text);

  x := gen_random_uuid();
  res1 := pg_temp.send(jsonb_build_array(pg_temp.ev('search_query', x, now() - interval '5 days', null, null, null, 'search',
    '{"query":"кот"}')));
  perform pg_temp.check('К2.2 событие старше 72 ч — too_old', pg_temp.reason(res1, x) = 'too_old', res1::text);

  x := gen_random_uuid();
  res1 := pg_temp.send(jsonb_build_array(pg_temp.ev('search_query', x, now(), null, null, null, 'search',
    jsonb_build_object('query', 'к', 'pad', repeat('x', 9000)))));
  perform pg_temp.check('К2.2 слишком большой data — too_large', pg_temp.reason(res1, x) = 'too_large', res1::text);

  res1 := pg_temp.send(jsonb_build_array(jsonb_build_object('id', 'not-a-uuid', 'kind', 'search_query', 'ts', 1)));
  perform pg_temp.check('К2.2 кривой id — bad_id', res1 -> 'rejected' -> 0 ->> 'reason' = 'bad_id', res1::text);

  perform pg_temp.as_service();
  perform pg_temp.check('К2.2 отклонённое не записано и учтено по причинам',
    (select count(*) from public.rec_events where user_id = b and origin = 'client') = 3
      and (select coalesce(sum(count), 0) from public.rec_reject_counts
           where day = (now() at time zone 'UTC')::date and reason = 'implausible') >= 3);

  perform pg_temp.act_as(b);
  select jsonb_agg(pg_temp.ev('search_query', gen_random_uuid(), now(), null, null, null, 'search', '{"query":"q"}'))
  into big from generate_series(1, 101);
  perform pg_temp.refused('К2.2 пачка больше лимита (100) — отказ', format('select pg_temp.send(%L)', big), '22023');

  -- Частота: 600 в минуту.
  for i in 1 .. 5 loop
    select jsonb_agg(pg_temp.ev('search_query', gen_random_uuid(), now(), null, null, null, 'search', '{"query":"q"}'))
    into big from generate_series(1, 100);
    perform pg_temp.send(big);
  end loop;
  select jsonb_agg(pg_temp.ev('search_query', gen_random_uuid(), now(), null, null, null, 'search', '{"query":"q"}'))
  into big from generate_series(1, 97);
  res1 := pg_temp.send(big);
  perform pg_temp.check('К2.2 в лимит частоты — принято', jsonb_array_length(res1 -> 'accepted') = 97, res1::text);
  select jsonb_agg(pg_temp.ev('search_query', gen_random_uuid(), now(), null, null, null, 'search', '{"query":"q"}'))
  into big from generate_series(1, 1);
  perform pg_temp.refused('К2.2 сверх лимита частоты — отказ', format('select pg_temp.send(%L)', big), '22023');

  -- ====================================== К2.3 — показ без конца → lost
  perform pg_temp.act_as(c);
  x := gen_random_uuid();
  res1 := pg_temp.send(jsonb_build_array(
    pg_temp.ev('impression_start', gen_random_uuid(), now() - interval '20 seconds', x, 'pop', pop, 'search', '{"entry":"search_result"}'),
    pg_temp.ev('impression_progress', gen_random_uuid(), now() - interval '15 seconds', x, null, null, null,
      '{"visible_ms":5000,"watch_ms":4200,"max_pos_ms":4200,"coverage":15}')
  ));

  perform pg_temp.as_service();
  -- Приложение убито пять минут назад: последний снимок давно.
  update public.rec_events
  set server_ts = server_ts - interval '5 minutes', event_ts = event_ts - interval '5 minutes'
  where impression_id = x;
  update public.rec_rollup_state set watermark = now() - interval '10 minutes';
  r := public.rec_rollup(now());

  perform pg_temp.check('К2.3 показ без конца закрыт свёрткой с exit = lost',
    (select exit = 'lost' and ended_at = last_seen_at and watch_ms = 4200 and surface = 'search'
     from public.rec_impressions where id = x),
    r::text);
  perform pg_temp.check('К2.3 законченный показ закрыт своим exit',
    (select exit = 'swipe_next' and watch_ms = 9500 and loops = 1 and completed from public.rec_impressions where id = imp));
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
