-- Журнал рекомендаций (этап 1): свёртка — метки в окне опоздания,
-- уникальность и исключение публикующих в агрегатах попа, тепловая карта,
-- сессии приложения, идемпотентность повторного запуска.
--
-- Время в одной транзакции стоит на месте, поэтому события принимаются
-- «сейчас» и затем сдвигаются в прошлое служебной ролью.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/rec_journal_rollup.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000009a1', 'ua@test.local', '{"full_name":"Автор канала"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000009b1', 'ub@test.local', '{"full_name":"Зритель B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000009c1', 'uc@test.local', '{"full_name":"Зритель C"}', 'authenticated', 'authenticated');

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

create function pg_temp.ms(t timestamptz) returns bigint
language sql as $$ select (extract(epoch from t) * 1000)::bigint $$;

create function pg_temp.ev(kind text, at timestamptz, impression uuid, extra jsonb, data jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('id', gen_random_uuid(), 'kind', kind, 'v', 1, 'ts', pg_temp.ms(at),
    'impression_id', impression, 'data', data) || extra
$$;

/**
 * Показ `who` попа `target`, начатый в `start_at`: 10 с на экране, снимок
 * `snap` и конец. Принимается сейчас, затем переезжает в `start_at`.
 */
create function pg_temp.impression(who uuid, target uuid, start_at timestamptz, snap jsonb, session uuid default null)
returns uuid
language plpgsql as $$
declare
  imp uuid := gen_random_uuid();
  res jsonb;
begin
  perform pg_temp.act_as(who);
  res := public.rec_record_events(jsonb_build_object('sent_at', pg_temp.ms(now()), 'events', jsonb_build_array(
    pg_temp.ev('impression_start', now() - interval '10 seconds', imp,
      jsonb_strip_nulls(jsonb_build_object('subject_type', 'pop', 'subject_id', target, 'surface', 'channel', 'app_session_id', session)),
      '{"entry":"channel_grid","volume":0.6,"muted":false,"route":"speaker"}'),
    pg_temp.ev('impression_end', now(), imp, jsonb_strip_nulls(jsonb_build_object('app_session_id', session)),
      '{"exit":"swipe_next"}'::jsonb || snap)
  )));

  if jsonb_array_length(res -> 'rejected') > 0 then
    raise exception 'impression rejected: %', res;
  end if;

  perform pg_temp.as_service();
  update public.rec_events
  set server_ts = server_ts + (start_at - (now() - interval '10 seconds')),
      event_ts = event_ts + (start_at - (now() - interval '10 seconds'))
  where impression_id = imp;

  return imp;
end;
$$;

/** Последнее серверное событие `who` этого вида — в момент `at`. */
create function pg_temp.move_last(who uuid, event_kind text, at timestamptz) returns void
language plpgsql as $$
begin
  perform pg_temp.as_service();
  update public.rec_events
  set server_ts = at, event_ts = at
  where id = (
    select id from public.rec_events
    where user_id = who and kind = event_kind and origin = 'server' and server_ts > now() - interval '1 minute'
    order by server_ts desc limit 1
  );
end;
$$;

create function pg_temp.flush() returns void language plpgsql as $$
begin
  set constraints public.comments_rec_journal, public.messages_rec_journal immediate;
  set constraints public.comments_rec_journal, public.messages_rec_journal deferred;
end;
$$;

/** Свёртка с начала журнала теста до сейчас за один проход. */
create function pg_temp.rollup(since timestamptz) returns jsonb
language plpgsql as $$
begin
  perform pg_temp.as_service();
  update public.rec_rollup_state set watermark = since;
  return public.rec_rollup(now());
end;
$$;

/** Всё, что свёртка насчитала по попу, — для сравнения повторов. */
create function pg_temp.snapshot(target uuid) returns text
language sql as $$
  select concat_ws(' || ',
    (select string_agg(row_to_json(x)::text, ',' order by x.id) from (
      select id, exit, watch_ms, coverage, loops, completed, quick_skip, reaction_emoji, reaction_valence,
        comments_sent, forwards, subscribed, returned_later, labels_closed_at is not null as closed, applied
      from public.rec_impressions where subject_id = target
    ) x),
    (select row_to_json(s)::text from (
      select impressions_raw, impressions, viewers, viewers_weighted, watch_ms, completions, quick_skips,
        loops, reactions, comments
      from public.rec_pop_stats where pop_id = target
    ) s),
    (select row_to_json(h)::text from (
      select views, seeks_back_into, seeks_fwd_from, pauses from public.rec_pop_heat where pop_id = target
    ) h),
    (select string_agg(row_to_json(h)::text, ',' order by h.hour) from (
      select hour, impressions, viewers, watch_ms, reactions, comments from public.rec_pop_hourly where pop_id = target
    ) h)
  )
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000009a1';
  b uuid := '00000000-0000-4000-8000-0000000009b1';
  c uuid := '00000000-0000-4000-8000-0000000009c1';
  video jsonb := '{"url":"u1/pops/v.mp4","poster_url":"u1/pops/p.jpg","mime_type":"video/mp4","width":720,"height":1280,"duration_ms":8000}';
  r jsonb;
  chan uuid;
  pop uuid := gen_random_uuid();
  pop2 uuid := gen_random_uuid();
  t0 timestamptz := now() - interval '4 days';
  t1 timestamptz := now() - interval '3 hours';
  imp uuid;
  imp_heat uuid;
  imps uuid[] := '{}';
  pub_imp uuid;
  later_imp uuid;
  late_imp uuid;
  session uuid := gen_random_uuid();
  s1 text;
  s2 text;
  st record;
  res jsonb;
begin
  perform pg_temp.as_service();
  -- Один проход свёртки накрывает весь тест.
  insert into public.rec_config (version, params, note)
  select version + 1, params || '{"rollupMaxWindowMinutes": 10000}', 'тест'
  from public.rec_config order by version desc limit 1;

  perform pg_temp.act_as(a);
  r := public.create_channel('Свёртка', 'rec_rollup_zz');
  chan := (r ->> 'channel_id')::uuid;
  perform public.publish_pop(chan, pop, video, 'Поп', null, false, null, null);
  perform public.publish_pop(chan, pop2, video, 'Поп 2', null, false, null, null);

  -- ====================== К5.1 — метки через 10 мин и 2 ч, не через 3 суток
  imp := pg_temp.impression(b, pop, t0, '{"visible_ms":10000,"watch_ms":9000,"max_pos_ms":8000,"coverage":255,"loops":1,"first_frame_ms":300}');

  perform pg_temp.act_as(b);
  perform public.set_reaction('pop', pop, '❤️');
  perform pg_temp.move_last(b, 'reaction_set', t0 + interval '10 minutes');
  perform pg_temp.act_as(b);
  perform public.send_pop_comment(pop, 'смешно');
  perform pg_temp.flush();
  perform pg_temp.move_last(b, 'comment_sent', t0 + interval '2 hours');
  perform pg_temp.act_as(b);
  perform public.set_reaction('pop', pop, '🤮');
  perform pg_temp.move_last(b, 'reaction_set', t0 + interval '3 days');

  -- ========================== К5.2 — 20 показов одного человека подряд
  for i in 0 .. 19 loop
    imps := imps || pg_temp.impression(c, pop2, t1 + make_interval(mins => i),
      '{"visible_ms":10000,"watch_ms":4000,"max_pos_ms":4000,"coverage":15,"first_frame_ms":400}', session);
  end loop;
  later_imp := pg_temp.impression(c, pop2, t1 + interval '90 minutes',
    '{"visible_ms":10000,"watch_ms":9000,"max_pos_ms":8000,"coverage":255,"loops":1,"first_frame_ms":400}', session);
  pub_imp := pg_temp.impression(a, pop2, t1, '{"visible_ms":10000,"watch_ms":8000,"max_pos_ms":8000,"coverage":255,"first_frame_ms":400}');

  -- Тепловая карта: перемотка назад к началу, вперёд к концу, пауза на 3-й секунде.
  imp_heat := pg_temp.impression(b, pop2, t1 + interval '5 minutes',
    '{"visible_ms":10000,"watch_ms":7000,"max_pos_ms":7600,"coverage":255,"first_frame_ms":400,
      "seeks_back":1,"seeks_fwd":1,"seek_back_ms":6500,"seek_fwd_ms":6500,
      "seeks":[{"from":7000,"to":500,"gesture_ms":600},{"from":1000,"to":7500,"gesture_ms":700}],
      "pauses":1,"pause_ms":3000,"pause_reasons":{"tap":3000},"pause_list":[{"at":3000,"ms":3000,"reason":"tap"}]}');

  -- Сессия приложения C.
  perform pg_temp.act_as(c);
  res := public.rec_record_events(jsonb_build_object('sent_at', pg_temp.ms(now()), 'events', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'kind', 'app_session_start', 'ts', pg_temp.ms(now() - interval '60 seconds'),
      'app_session_id', session, 'surface', 'app', 'data', '{"entry":"push","platform":"android","app_version":"1.0.0"}'::jsonb),
    jsonb_build_object('id', gen_random_uuid(), 'kind', 'screen_time', 'ts', pg_temp.ms(now() - interval '30 seconds'),
      'app_session_id', session, 'data', '{"screen":"channel","tab":"chats","ms":30000}'::jsonb),
    jsonb_build_object('id', gen_random_uuid(), 'kind', 'screen_time', 'ts', pg_temp.ms(now() - interval '10 seconds'),
      'app_session_id', session, 'data', '{"screen":"feed","tab":"feed","ms":20000}'::jsonb),
    jsonb_build_object('id', gen_random_uuid(), 'kind', 'app_background', 'ts', pg_temp.ms(now() - interval '5 seconds'),
      'app_session_id', session, 'data', '{"fg_ms":55000,"screen":"feed"}'::jsonb)
  )));

  perform pg_temp.check('события сессии приняты', jsonb_array_length(res -> 'accepted') = 4, res::text);

  -- Чужой id сессии не сливает события в сессию C.
  perform pg_temp.act_as(b);
  res := public.rec_record_events(jsonb_build_object('sent_at', pg_temp.ms(now()), 'events', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'kind', 'screen_time', 'ts', pg_temp.ms(now() - interval '20 seconds'),
      'app_session_id', session, 'data', '{"screen":"spoof","tab":"spoof","ms":99999}'::jsonb))));

  -- Офлайн-показ C, пришедший позже, но начатый за два часа до первых: отстоит
  -- от засчитанного дальше окна — тоже засчитан.
  late_imp := pg_temp.impression(c, pop2, t1 - interval '2 hours',
    '{"visible_ms":10000,"watch_ms":4000,"max_pos_ms":4000,"coverage":15,"first_frame_ms":400}', session);

  r := pg_temp.rollup(t0 - interval '1 minute');

  perform pg_temp.check('К5.1 реакция через 10 мин — в показе, с валентностью',
    (select reaction_emoji = '❤️' and reaction_valence = 1 and reaction_at = t0 + interval '10 minutes'
     from public.rec_impressions where id = imp), r::text);
  perform pg_temp.check('К5.1 комментарий через 2 ч — в показе',
    (select comments_sent = 1 and comment_chars = 6 from public.rec_impressions where id = imp));
  perform pg_temp.check('К5.1 реакция через 3 суток — не в этом показе, но в журнале',
    (select reaction_emoji from public.rec_impressions where id = imp) <> '🤮'
      and exists (select 1 from public.rec_events where user_id = b and kind = 'reaction_set' and data ->> 'emoji' = '🤮'));
  perform pg_temp.check('К5.1 окно опоздания прошло — метки закрыты',
    (select labels_closed_at is not null from public.rec_impressions where id = imp));

  perform pg_temp.check('К5.2 20 показов подряд — один уникальный зритель и один показ в окне уникальности',
    (select impressions_raw = 23 and impressions = 4 and viewers = 2 from public.rec_pop_stats where pop_id = pop2),
    (select row_to_json(s)::text from public.rec_pop_stats s where pop_id = pop2));
  perform pg_temp.check('К5.2 показы публикующего не считаются',
    (select is_publisher and applied = '{}'::jsonb from public.rec_impressions where id = pub_imp)
      and (select watch_ms from public.rec_pop_stats where pop_id = pop2) = 21 * 4000 + 9000 + 7000);
  perform pg_temp.check('К5.2 молодой аккаунт — с весом доверия',
    (select viewers_weighted = 0.5 from public.rec_pop_stats where pop_id = pop2),
    (select viewers_weighted::text from public.rec_pop_stats where pop_id = pop2));
  perform pg_temp.check('вернулся к попу позже — метка у прежнего показа',
    (select returned_later from public.rec_impressions where id = imps[20])
      and not (select returned_later from public.rec_impressions where id = later_imp));
  perform pg_temp.check('досмотр и круги',
    (select completed and loops = 1 from public.rec_impressions where id = later_imp)
      and not (select completed from public.rec_impressions where id = imps[1]));

  perform pg_temp.check('К4.3 тепловая карта: перемотка назад в 1-й сегмент, вперёд из 2-го, пауза в 4-м',
    (select seeks_back_into[1] = 1 and seeks_fwd_from[2] = 1 and pauses[4] = 1 and cardinality(views) = 8
       and views[1] = 23 from public.rec_pop_heat where pop_id = pop2),
    (select row_to_json(h)::text from public.rec_pop_heat h where pop_id = pop2));
  perform pg_temp.check('почасовые корзины',
    (select sum(impressions) = 4 and sum(viewers) = 2 from public.rec_pop_hourly where pop_id = pop2));

  select * into st from public.rec_app_sessions where id = session;
  perform pg_temp.check('сессия приложения: вход, время по вкладкам, конец в фоне',
    st.entry = 'push' and st.end_reason = 'background' and st.foreground_ms = 55000
      and (st.tabs ->> 'chats')::int = 30000 and (st.tabs ->> 'feed')::int = 20000 and st.last_screen = 'feed'
      and st.impressions = 22 and not st.tabs ? 'spoof'
      and (select count(*) from public.rec_app_sessions where id = session) = 1,
    row_to_json(st)::text);

  -- =============================== К5.3 — повторный запуск ничего не меняет
  s1 := pg_temp.snapshot(pop) || ' ## ' || pg_temp.snapshot(pop2);
  perform pg_temp.as_service();
  perform public.rec_rollup(now());
  s2 := pg_temp.snapshot(pop) || ' ## ' || pg_temp.snapshot(pop2);
  perform pg_temp.check('К5.3 повторный запуск свёртки не меняет результат', s1 = s2, s1 || ' <> ' || s2);

  -- Переобработка того же окна: показы и их вклад не удваиваются (метки
  -- попа — по водяному знаку, их окно не повторяется).
  update public.rec_rollup_state set watermark = t0 - interval '1 minute';
  update public.rec_pop_stats set reactions = 0, comments = 0 where pop_id in (pop, pop2);
  update public.rec_pop_hourly set reactions = 0, comments = 0 where pop_id in (pop, pop2);
  s1 := pg_temp.snapshot(pop) || ' ## ' || pg_temp.snapshot(pop2);
  perform public.rec_rollup(now());
  update public.rec_pop_stats set reactions = 0, comments = 0 where pop_id in (pop, pop2);
  update public.rec_pop_hourly set reactions = 0, comments = 0 where pop_id in (pop, pop2);
  s2 := pg_temp.snapshot(pop) || ' ## ' || pg_temp.snapshot(pop2);
  perform pg_temp.check('К5.3 переобработка окна не удваивает показы, зрителей и тепловую карту', s1 = s2, s1 || ' <> ' || s2);
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
