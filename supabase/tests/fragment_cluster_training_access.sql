-- Кластеры фрагментов (этап 3а): журнал решений модели и события людей —
-- данные для обучения. Кто пишет, кто читает, правило объёма журнала,
-- лимиты пачки событий, повтор показа, серверное событие нового фрагмента.
--
-- Обработчик очереди изображают вызовы `fragment_clusters_take` /
-- `fragment_clusters_apply` с готовым результатом модели и снимком решения.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/fragment_cluster_training_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a9', 'ta@test.local', '{"full_name":"Участник A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b9', 'tb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d9', 'td@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000e9', 'te@test.local', '{"full_name":"Посетитель E"}', 'authenticated', 'authenticated');

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

create function pg_temp.refused(name text, sql text, code text) returns void
language plpgsql as $$
begin
  execute sql;
  perform pg_temp.check(name, false, 'прошло');
exception when others then
  perform pg_temp.check(name, sqlstate = code, sqlstate || ' ' || sqlerrm);
end;
$$;

create function pg_temp.at(m uuid, piece text) returns int
language sql as $$
  select strpos((select text from public.messages where id = m), piece) - 1
$$;

create function pg_temp.react(m uuid, piece text, emoji text) returns uuid
language plpgsql as $$
declare
  s int := pg_temp.at(m, piece);
  r record;
begin
  select * into r from public.set_fragment_reaction(m, s, s + char_length(piece), piece, emoji);
  return r.fragment_id;
end;
$$;

create function pg_temp.comment_on(m uuid, piece text) returns uuid
language plpgsql as $$
declare
  s int := pg_temp.at(m, piece);
  c uuid;
begin
  c := public.send_comment(m, 'о куске «' || piece || '»', '[]'::jsonb, null, null,
    jsonb_build_object('start', s, 'end', s + char_length(piece), 'text', piece));
  return (select fragment_id from public.comments where id = c);
end;
$$;

/** Кластер результата модели: диапазон — кусок `piece`, отображаемое — кусок `shown` (null — не показан). */
create function pg_temp.cl(m uuid, id uuid, piece text, shown text, frags uuid[]) returns jsonb
language sql as $$
  select jsonb_build_object(
    'id', id,
    'start', pg_temp.at(m, piece),
    'end', pg_temp.at(m, piece) + char_length(piece),
    'popularity', cardinality(frags),
    'display', case when shown is not null then jsonb_build_object(
      'start', pg_temp.at(m, shown), 'end', pg_temp.at(m, shown) + char_length(shown)
    ) end,
    'fragmentIds', to_jsonb(frags)
  )
$$;

/** Обработчик: снимок, запись результата со снимком решения. */
create function pg_temp.recompute(m uuid, clusters jsonb) returns text
language plpgsql as $$
declare
  snap jsonb;
  outcome text;
begin
  perform public.fragment_clusters_enqueue(m);
  snap := public.fragment_clusters_take(
    m,
    coalesce(
      (select array_agg(msg_id) from pgmq.q_fragment_clusters where message ->> 'message_id' = m::text),
      '{}'::bigint[]
    )
  );
  outcome := public.fragment_clusters_apply(m, snap || jsonb_build_object(
    'clusters', clusters,
    'decision', jsonb_build_object(
      'scorer', 'test', 'mapVersion', 1, 'context', jsonb_build_object('people', 1),
      'weights', '{}'::jsonb, 'valleys', '[]'::jsonb, 'basins', '[]'::jsonb,
      'selected', '[]'::jsonb
    )
  ));
  perform set_config('open.clusters_writer', '', true);
  return outcome;
end;
$$;

/** Пачка из n одинаковых событий. */
create function pg_temp.batch(n int, kind text, m uuid, extra jsonb default '{}'::jsonb) returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object('kind', kind, 'message_id', m) || extra) from generate_series(1, n)
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a9';
  b uuid := '00000000-0000-4000-8000-0000000000b9';
  d uuid := '00000000-0000-4000-8000-0000000000d9';
  e uuid := '00000000-0000-4000-8000-0000000000e9';
  chat uuid;
  m uuid;
  other uuid;
  body text := 'Ну это какой-то другой уровень общения, а в самом конце живёт совсем отдельная мысль';
  fd uuid;
  fe1 uuid;
  fe2 uuid;
  fe3 uuid;
  k uuid;
  d1 uuid;
  d2 uuid;
  dother uuid;
  s text;
  n int;
  ev record;
begin
  -- ------------------------------------------------------------- подготовка
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b], null) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);
  perform pg_temp.act_as(a);
  m := pg_temp.say(chat, a, body);
  other := pg_temp.say(chat, a, 'другое сообщение со своим кластером');

  -- Первый фрагмент: подсветки ещё нет — событие «вне», без снимка.
  perform pg_temp.act_as(d);
  fd := pg_temp.react(m, 'другой уровень', '🔥');

  perform pg_temp.as_service();
  select * into ev from public.fragment_cluster_events where fragment_id = fd;
  perform pg_temp.check('К5.2 первый фрагмент без подсветки — событие «вне», снимка нет',
    ev.kind = 'fragment_created' and ev.placement = 'outside' and ev.decision_id is null and ev.user_id = d
      and ev.range_start = pg_temp.at(m, 'другой уровень'),
    row_to_json(ev)::text);

  -- ===================================== К4.1 пересчёт пишет снимок решения
  s := pg_temp.recompute(m, jsonb_build_array(pg_temp.cl(m, null, 'другой уровень', 'другой уровень', array[fd])));
  select id, decision_id into k, d1 from public.fragment_clusters where message_id = m and deleted_at is null;
  perform pg_temp.check('К4.1 после пересчёта снимок решения есть и у кластера его id',
    s = 'applied' and d1 is not null
      and (select count(*) from public.fragment_cluster_decisions where message_id = m) = 1
      and (select decision_id from public.fragment_cluster_state where message_id = m) = d1,
    s);
  perform pg_temp.check('К4.1 снимок помнит, что показали, и не хранит текст',
    (select displayed -> 0 ->> 'cluster_id' from public.fragment_cluster_decisions where id = d1) = k::text
      and (select decision::text from public.fragment_cluster_decisions where id = d1) not like '%другой%'
      and (select scorer from public.fragment_cluster_decisions where id = d1) = 'test');

  perform pg_temp.act_as(e);
  select count(*) into n from public.list_message_clusters(m) c where c.decision_id = d1;
  perform pg_temp.check('К4.1 list_message_clusters отдаёт id снимка', n = 1, n::text);
  perform pg_temp.refused('К4.1 пользователь не читает журнал решений',
    'select count(*) from public.fragment_cluster_decisions', '42501');
  perform pg_temp.refused('К4.1 пользователь не пишет журнал решений',
    format('insert into public.fragment_cluster_decisions (message_id, model_version, decision) values (%L, 2, %L)', m, '{}'),
    '42501');
  perform pg_temp.refused('К4.1 пользователь не зовёт очистку журнала',
    'select public.fragment_cluster_history_cleanup()', '42501');

  -- ===================================== К4.2 правило объёма
  perform pg_temp.as_service();
  s := pg_temp.recompute(m, jsonb_build_array(pg_temp.cl(m, k, 'другой уровень', 'другой уровень', array[fd])));
  perform pg_temp.check('К4.2 пересчёт без смены отображаемого — нового снимка нет',
    (select count(*) from public.fragment_cluster_decisions where message_id = m) = 1
      and (select decisions_skipped from public.fragment_cluster_state where message_id = m) = 1
      and (select decision_id from public.fragment_clusters where id = k) = d1,
    s);

  s := pg_temp.recompute(m, jsonb_build_array(pg_temp.cl(m, k, 'другой уровень', 'уровень', array[fd])));
  select decision_id into d2 from public.fragment_clusters where id = k;
  perform pg_temp.check('К4.2 отображаемое сменилось — новый снимок, кластер ссылается на него',
    (select count(*) from public.fragment_cluster_decisions where message_id = m) = 2
      and d2 is distinct from d1 and d2 is not null
      and (select decisions_skipped from public.fragment_cluster_state where message_id = m) = 0,
    s);

  s := pg_temp.recompute(other, '[]'::jsonb);
  select decision_id into dother from public.fragment_cluster_state where message_id = other;

  -- ===================================== К5.2 новый фрагмент относительно подсветки
  -- Сейчас отображается «уровень».
  perform pg_temp.act_as(e);
  fe1 := pg_temp.react(m, 'уров', '🤣');
  fe2 := pg_temp.comment_on(m, 'уровень общения');
  fe3 := pg_temp.react(m, 'отдельная мысль', '🔥');

  perform pg_temp.as_service();
  select * into ev from public.fragment_cluster_events where fragment_id = fe1;
  perform pg_temp.check('К5.2 фрагмент внутри отображаемого — «внутри», снимок и кластер',
    ev.placement = 'inside' and ev.decision_id = d2 and ev.cluster_id = k and ev.user_id = e,
    row_to_json(ev)::text);
  select * into ev from public.fragment_cluster_events where fragment_id = fe2;
  perform pg_temp.check('К5.2 фрагмент частично в отображаемом — «частично»',
    ev.placement = 'partial' and ev.decision_id = d2 and ev.cluster_id = k
      and (ev.detail ->> 'overlap')::int = char_length('уровень'),
    row_to_json(ev)::text);
  select * into ev from public.fragment_cluster_events where fragment_id = fe3;
  perform pg_temp.check('К5.2 фрагмент вне отображаемых — «вне», снимок есть, кластера нет',
    ev.placement = 'outside' and ev.decision_id = d2 and ev.cluster_id is null,
    row_to_json(ev)::text);

  -- Вторая реакция на тот же живой фрагмент — не рождение: события нет.
  perform pg_temp.act_as(e);
  perform pg_temp.react(m, 'уров', '🔥');
  perform pg_temp.as_service();
  select count(*) into n from public.fragment_cluster_events where fragment_id = fe1;
  perform pg_temp.check('К5.2 смена реакции на живом фрагменте события не пишет', n = 1, n::text);

  -- ===================================== К5.1 события клиента
  perform pg_temp.act_as(e);
  n := public.record_fragment_cluster_events(jsonb_build_array(
    jsonb_build_object('kind', 'clusters_shown', 'message_id', m, 'decision_id', d2, 'detail', jsonb_build_object('shown', 1)),
    jsonb_build_object('kind', 'cluster_opened', 'message_id', m, 'decision_id', d2, 'cluster_id', k,
      'user_id', d),
    jsonb_build_object('kind', 'area_opened', 'message_id', m, 'decision_id', d2,
      'range_start', pg_temp.at(m, 'отдельная'), 'range_end', pg_temp.at(m, 'отдельная') + 9),
    -- Чужой снимок и чужой кластер — обнулятся.
    jsonb_build_object('kind', 'cluster_reacted', 'message_id', m, 'decision_id', dother, 'cluster_id', gen_random_uuid())
  ));
  perform pg_temp.check('К5.1 пачка записана целиком', n = 4, n::text);

  perform pg_temp.as_service();
  perform pg_temp.check('К5.1 события — от имени вызвавшего, подделать автора нельзя',
    (select count(*) from public.fragment_cluster_events where user_id = e and kind <> 'fragment_created') = 4
      and not exists (select 1 from public.fragment_cluster_events where user_id = d and kind <> 'fragment_created'));
  perform pg_temp.check('К5.1 диапазон области и кластер панели сохранены',
    exists (select 1 from public.fragment_cluster_events
      where kind = 'area_opened' and range_start = pg_temp.at(m, 'отдельная') and range_end - range_start = 9)
      and exists (select 1 from public.fragment_cluster_events where kind = 'cluster_opened' and cluster_id = k));
  perform pg_temp.check('К5.1 ссылки не на это сообщение обнуляются',
    exists (select 1 from public.fragment_cluster_events
      where kind = 'cluster_reacted' and decision_id is null and cluster_id is null));

  perform pg_temp.act_as(e);
  n := public.record_fragment_cluster_events(jsonb_build_array(
    jsonb_build_object('kind', 'clusters_shown', 'message_id', m, 'decision_id', d2)
  ));
  perform pg_temp.check('К5.1 повторный показ того же снимка в окне не дублируется', n = 0, n::text);

  perform pg_temp.act_as(d);
  n := public.record_fragment_cluster_events(jsonb_build_array(
    jsonb_build_object('kind', 'clusters_shown', 'message_id', m, 'decision_id', d2)
  ));
  perform pg_temp.check('К5.1 показ того же снимка другому человеку пишется', n = 1, n::text);

  perform pg_temp.act_as(e);
  perform pg_temp.refused('К5.1 пачка больше лимита отклоняется',
    format('select public.record_fragment_cluster_events(%L)', pg_temp.batch(51, 'cluster_opened', m)), '22023');
  perform pg_temp.refused('К5.1 серверное событие клиент не пишет',
    format('select public.record_fragment_cluster_events(%L)', pg_temp.batch(1, 'fragment_created', m)), '22023');
  perform pg_temp.refused('К5.1 таблица событий не читается',
    'select count(*) from public.fragment_cluster_events', '42501');
  perform pg_temp.refused('К5.1 прямая вставка события запрещена',
    format('insert into public.fragment_cluster_events (user_id, message_id, kind) values (%L, %L, %L)', e, m, 'cluster_opened'),
    '42501');

  -- Частота: не больше eventsPerMinute (300) событий человека в минуту.
  for i in 1..5 loop
    perform public.record_fragment_cluster_events(pg_temp.batch(50, 'cluster_opened', m));
  end loop;
  perform pg_temp.refused('К5.1 частота сверх лимита отклоняется',
    format('select public.record_fragment_cluster_events(%L)', pg_temp.batch(50, 'cluster_opened', m)), '22023');

  -- ===================================== Ретенция
  perform pg_temp.as_service();
  update public.fragment_cluster_events set created_at = now() - interval '200 days' where message_id = m;
  update public.fragment_cluster_decisions set created_at = now() - interval '200 days' where message_id = m;
  perform public.fragment_cluster_history_cleanup();
  perform pg_temp.check('ретенция: старые события удалены, показываемый снимок оставлен, прежний удалён',
    not exists (select 1 from public.fragment_cluster_events where message_id = m)
      and exists (select 1 from public.fragment_cluster_decisions where id = d2)
      and not exists (select 1 from public.fragment_cluster_decisions where id = d1));
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
