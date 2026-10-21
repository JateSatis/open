-- Кластеры фрагментов (этап 3а): кто что читает и пишет, «одна реакция
-- человека на кластер», привязка нового фрагмента, заявки на пересчёт,
-- запись результата модели и схлопывание реакций при слиянии.
--
-- Обработчик очереди здесь изображают вызовы `fragment_clusters_take` /
-- `fragment_clusters_apply` с готовым результатом модели — саму модель
-- проверяют deno-тесты (`supabase/functions/_shared/fragmentClusters.test.ts`).
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/fragment_clusters_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a8', 'ka@test.local', '{"full_name":"Участник A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b8', 'kb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d8', 'kd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000e8', 'ke@test.local', '{"full_name":"Посетитель E"}', 'authenticated', 'authenticated');

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

/** Начало куска в тексте сообщения, code points от нуля. */
create function pg_temp.at(m uuid, piece text) returns int
language sql as $$
  select strpos((select text from public.messages where id = m), piece) - 1
$$;

/** Реакция текущего пользователя на кусок текста; отдаёт фрагмент. */
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

/** Комментарий текущего пользователя к куску текста; отдаёт фрагмент комментария. */
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

/** Кластер результата модели: диапазон и отображаемое — по кускам текста. */
create function pg_temp.cl(m uuid, id uuid, piece text, shown boolean, frags uuid[]) returns jsonb
language sql as $$
  select jsonb_build_object(
    'id', id,
    'start', pg_temp.at(m, piece),
    'end', pg_temp.at(m, piece) + char_length(piece),
    'popularity', cardinality(frags),
    'display', case when shown then jsonb_build_object(
      'start', pg_temp.at(m, piece), 'end', pg_temp.at(m, piece) + char_length(piece)
    ) end,
    'fragmentIds', to_jsonb(frags)
  )
$$;

/** Заявки сообщения в очереди. */
create function pg_temp.queued(m uuid) returns int
language sql as $$
  select count(*)::int from pgmq.q_fragment_clusters where message ->> 'message_id' = m::text
$$;

/** Обработчик: снимок с арендой. */
create function pg_temp.take(m uuid) returns jsonb
language sql as $$
  select public.fragment_clusters_take(
    m,
    coalesce(
      (select array_agg(msg_id) from pgmq.q_fragment_clusters where message ->> 'message_id' = m::text),
      '{}'::bigint[]
    )
  )
$$;

/** Обработчик: запись результата модели по снимку и схлопывание реакций. */
create function pg_temp.apply(m uuid, snap jsonb, clusters jsonb) returns text
language plpgsql as $$
declare
  outcome text;
begin
  outcome := public.fragment_clusters_apply(m, snap || jsonb_build_object('clusters', clusters));
  -- У обработчика запись и схлопывание — отдельные транзакции; здесь одна,
  -- и настройки записи надо вернуть самим.
  perform set_config('open.clusters_writer', '', true);
  perform public.fragment_clusters_dedup(m);
  return outcome;
end;
$$;

/** Сводные счётчики кластера совпадают с суммой по его фрагментам. */
create function pg_temp.counters_agree(k uuid) returns text
language sql as $$
  select case when
    c.reactions_count = coalesce(s.reactions, 0)
    and c.comments_count = coalesce(s.comments, 0)
    and c.member_reactions = coalesce(s.member, '{}'::jsonb)
    and c.visitor_reactions = coalesce(s.visitor, '{}'::jsonb)
    and c.people_count = coalesce(p.people, 0)
  then 'ok' else format('кластер %s / фрагменты %s, людей %s', row_to_json(c), row_to_json(s), p.people) end
  from public.fragment_clusters c
  left join lateral (
    select
      sum(f.reactions_count)::int as reactions,
      sum(f.comments_count)::int as comments,
      (select jsonb_object_agg(key, total) from (
        select e.key, sum(e.value::int) as total
        from public.message_fragments f2, jsonb_each_text(f2.member_reactions) e
        where f2.cluster_id = k and f2.deleted_at is null group by e.key) x) as member,
      (select jsonb_object_agg(key, total) from (
        select e.key, sum(e.value::int) as total
        from public.message_fragments f2, jsonb_each_text(f2.visitor_reactions) e
        where f2.cluster_id = k and f2.deleted_at is null group by e.key) x) as visitor
    from public.message_fragments f
    where f.cluster_id = k and f.deleted_at is null
  ) s on true
  left join lateral (
    select count(distinct u)::int as people from (
      select r.user_id as u from public.message_fragments f
      join public.reactions r on r.target_type = 'fragment' and r.target_id = f.id and r.deleted_at is null
      where f.cluster_id = k and f.deleted_at is null
      union
      select c2.author_id from public.message_fragments f
      join public.comments c2 on c2.fragment_id = f.id and c2.deleted_at is null
      where f.cluster_id = k and f.deleted_at is null
    ) v
  ) p on true
  where c.id = k
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a8';
  b uuid := '00000000-0000-4000-8000-0000000000b8';
  d uuid := '00000000-0000-4000-8000-0000000000d8';
  e uuid := '00000000-0000-4000-8000-0000000000e8';
  chat uuid;
  m uuid;
  m2 uuid;
  m3 uuid;
  body text := 'Ну это какой-то другой уровень общения, а в самом конце сообщения живёт совсем отдельная мысль';
  snap jsonb;
  snap2 jsonb;
  k uuid;
  k2 uuid;
  k3 uuid;
  fd1 uuid;
  fd2 uuid;
  fd3 uuid;
  fe1 uuid;
  fe2 uuid;
  fc uuid;
  r record;
  s text;
  n int;
  due int[];
  emojis text[] := array['🔥', '🤣'];
begin
  -- ------------------------------------------------------------- подготовка
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);
  perform pg_temp.act_as(a);
  m := pg_temp.say(chat, a, body);
  m2 := pg_temp.say(chat, a, 'это сообщение для подсчёта взаимодействий');
  m3 := pg_temp.say(chat, a, 'начало отдельно, середина пустая, а конец отдельно');

  -- ===================================== К2.3: новый фрагмент в нетронутом месте
  perform pg_temp.act_as(d);
  fd1 := pg_temp.react(m, 'какой-то другой уровень', '🔥');

  perform pg_temp.as_service();
  perform pg_temp.check('К2.3 новый фрагмент в нетронутом месте — без кластера',
    (select cluster_id from public.message_fragments where id = fd1) is null);
  perform pg_temp.check('К2.3 … и его заявка в очереди', pg_temp.queued(m) = 1, pg_temp.queued(m)::text);

  -- Пересчёт: один кластер на «какой-то другой уровень».
  snap := pg_temp.take(m);
  perform pg_temp.check('снимок видит живой фрагмент и голос',
    jsonb_array_length(snap -> 'fragments') = 1 and jsonb_array_length(snap -> 'votes') = 1, snap::text);
  s := pg_temp.apply(m, snap, jsonb_build_array(pg_temp.cl(m, null, 'какой-то другой уровень', true, array[fd1])));
  select id into k from public.fragment_clusters where message_id = m and deleted_at is null;
  perform pg_temp.check('запись результата создаёт кластер и привязывает фрагмент',
    s = 'applied' and k is not null and (select cluster_id from public.message_fragments where id = fd1) = k, s);
  perform pg_temp.check('запись снимает заявку', pg_temp.queued(m) = 0, pg_temp.queued(m)::text);
  perform pg_temp.check('сводные счётчики кластера после записи', pg_temp.counters_agree(k) = 'ok', pg_temp.counters_agree(k));

  -- ===================================== К1.1: чтение и запись кластеров
  perform pg_temp.act_as(e);
  select count(*) into n from public.fragment_clusters where message_id = m;
  perform pg_temp.check('К1.1 посторонний читает отображаемые кластеры чужого чата', n = 1, n::text);
  perform pg_temp.refused('К1.1 кластер не вставить',
    format('insert into public.fragment_clusters (message_id, chat_id, start_offset, end_offset, model_version) values (%L, %L, 0, 3, 1)', m, chat),
    '42501');
  perform pg_temp.refused('К1.1 кластер не поменять',
    format('update public.fragment_clusters set popularity = 999 where id = %L', k), '42501');
  perform pg_temp.refused('К1.1 кластер не удалить',
    format('delete from public.fragment_clusters where id = %L', k), '42501');
  perform pg_temp.refused('К1.1 кластер фрагмента не переставить',
    format('update public.message_fragments set cluster_id = null where id = %L', fd1), '42501');
  perform pg_temp.refused('К1.1 состояние модели закрыто',
    'select count(*) from public.fragment_cluster_state', '42501');
  perform pg_temp.refused('К1.1 конфигурация закрыта',
    'select count(*) from public.fragment_cluster_config', '42501');
  perform pg_temp.refused('К1.1 голоса кластера закрыты',
    'select count(*) from public.fragment_cluster_voters', '42501');
  perform pg_temp.refused('К1.1 очередь закрыта',
    'select count(*) from pgmq.q_fragment_clusters', '42501');
  perform pg_temp.refused('К1.1 снимок пересчёта не взять',
    'select public.fragment_clusters_claim(10)', '42501');
  perform pg_temp.refused('К1.1 результат пересчёта не записать',
    format('select public.fragment_clusters_apply(%L, %L::jsonb)', m, '{"clusters":[]}'), '42501');
  perform pg_temp.refused('К1.1 заявку не поставить',
    format('select public.fragment_clusters_touch(%L, true, true)', m), '42501');

  -- ===================================== К1.2 / К2.3: фрагмент, пересекающий кластер
  perform pg_temp.act_as(e);
  fe1 := pg_temp.react(m, 'другой уровень общения', '👍');

  perform pg_temp.as_service();
  perform pg_temp.check('К2.3 пересекающий кластер фрагмент сразу в нём',
    (select cluster_id from public.message_fragments where id = fe1) = k);
  select reactions_count, visitor_reactions, people_count into r from public.fragment_clusters where id = k;
  perform pg_temp.check('К1.2 реакция на фрагмент кластера сразу в сводном счётчике',
    r.reactions_count = 2 and r.visitor_reactions = '{"🔥":1,"👍":1}'::jsonb and r.people_count = 2, r::text);

  -- ===================================== К2.1: одна реакция человека на кластер
  perform pg_temp.act_as(d);
  fd2 := pg_temp.react(m, 'другой уровень', '🤣');

  perform pg_temp.as_service();
  select count(*) into n from public.reactions
  where target_type = 'fragment' and target_id = fd1 and deleted_at is null;
  perform pg_temp.check('К2.1 🤣 на другом фрагменте кластера снимает 🔥', n = 0, n::text);
  perform pg_temp.check('К2.1 … 🤣 на новом фрагменте',
    (select emoji from public.reactions where target_type = 'fragment' and target_id = fd2 and user_id = d and deleted_at is null) = '🤣');
  perform pg_temp.check('К2.1 фрагмент без реакций уснул и ушёл из кластера',
    (select deleted_at is not null and cluster_id is null from public.message_fragments where id = fd1));
  perform pg_temp.check('К2.1 счётчики фрагментов сходятся',
    (select reactions_count = 1 and visitor_reactions = '{"🤣":1}'::jsonb from public.message_fragments where id = fd2));
  perform pg_temp.check('К2.1 счётчики кластера сходятся', pg_temp.counters_agree(k) = 'ok', pg_temp.counters_agree(k));
  select reactions_count, visitor_reactions, people_count into r from public.fragment_clusters where id = k;
  perform pg_temp.check('К2.1 в кластере 🤣 и 👍, два человека',
    r.reactions_count = 2 and r.visitor_reactions = '{"🤣":1,"👍":1}'::jsonb and r.people_count = 2, r::text);

  -- Меню старого куска: моей реакции на нём нет.
  perform pg_temp.act_as(d);
  select count(*) into n from public.list_message_fragments(m) f
  where f.start_offset = pg_temp.at(m, 'какой-то другой уровень') and f.my_emoji is not null;
  perform pg_temp.check('К2.4 на прежнем куске моей реакции больше нет', n = 0, n::text);

  -- Прямая вставка мимо set_reaction — то же правило.
  perform pg_temp.act_as(e);
  fe2 := pg_temp.comment_on(m, 'уровень');
  perform pg_temp.check('комментарий к куску внутри кластера — фрагмент в кластере',
    (select cluster_id from public.message_fragments where id = fe2) = k);
  insert into public.reactions (target_type, target_id, user_id, emoji) values ('fragment', fe2, e, '🔥');
  perform pg_temp.as_service();
  select count(*) into n from public.reactions r2
  join public.message_fragments f on f.id = r2.target_id
  where r2.target_type = 'fragment' and r2.user_id = e and r2.deleted_at is null and f.cluster_id = k;
  perform pg_temp.check('прямая вставка реакции тоже заменяет прежнюю в кластере', n = 1, n::text);
  perform pg_temp.check('комментарий не снимается — их сколько угодно',
    (select comments_count from public.message_fragments where id = fe2) = 1);
  perform pg_temp.check('счётчики кластера после комментария и вставки', pg_temp.counters_agree(k) = 'ok', pg_temp.counters_agree(k));

  -- Снятие реакции не задевает другие.
  perform pg_temp.act_as(e);
  perform public.set_reaction('fragment', fe2, null);
  perform pg_temp.as_service();
  perform pg_temp.check('снятие реакции оставляет фрагмент с комментарием в кластере',
    (select deleted_at is null and cluster_id = k from public.message_fragments where id = fe2));
  perform pg_temp.check('счётчики кластера после снятия', pg_temp.counters_agree(k) = 'ok', pg_temp.counters_agree(k));

  -- ===================================== К2.2: реакции в разных кластерах живут
  perform pg_temp.act_as(d);
  fd3 := pg_temp.react(m, 'совсем отдельная мысль', '🔥');
  perform pg_temp.as_service();
  snap := pg_temp.take(m);
  s := pg_temp.apply(m, snap, jsonb_build_array(
    pg_temp.cl(m, k, 'какой-то другой уровень общения', true, array[fd2, fe1, fe2]),
    pg_temp.cl(m, null, 'совсем отдельная мысль', true, array[fd3])
  ));
  select id into k2 from public.fragment_clusters where message_id = m and deleted_at is null and id <> k;
  perform pg_temp.check('второй кластер появился, первый сохранил id',
    s = 'applied' and k2 is not null and (select cluster_id from public.message_fragments where id = fd2) = k
      and (select cluster_id from public.message_fragments where id = fd3) = k2, s);
  select count(*) into n from public.reactions
  where target_type = 'fragment' and user_id = d and deleted_at is null and target_id in (fd2, fd3);
  perform pg_temp.check('К2.2 🔥 в одном кластере и 🤣 в другом — обе живы', n = 2, n::text);

  -- ===================================== К4.4: мост сливает кластеры
  -- В одной транзакции now() один — «раньше» и «позже» ставим руками.
  update public.reactions set updated_at = now() - interval '1 minute'
  where target_type = 'fragment' and target_id = fd2 and user_id = d;

  perform pg_temp.act_as(b);
  fc := pg_temp.react(m, 'общения, а в самом конце сообщения живёт совсем', '🤝');
  perform pg_temp.as_service();
  -- «общения» (7) против «совсем» (6).
  perform pg_temp.check('мост пересекает оба кластера — входит в тот, где пересечение больше',
    (select cluster_id from public.message_fragments where id = fc) = k);
  snap := pg_temp.take(m);
  s := pg_temp.apply(m, snap, jsonb_build_array(
    pg_temp.cl(m, k, 'какой-то другой уровень общения, а в самом конце сообщения живёт совсем отдельная мысль', true,
      array[fd2, fe1, fe2, fd3, fc])
  ));
  select count(*) into n from public.reactions
  where target_type = 'fragment' and user_id = d and deleted_at is null;
  perform pg_temp.check('К4.4 после слияния у человека одна живая реакция', n = 1, n::text);
  perform pg_temp.check('К4.4 … последняя по времени (🔥 на «отдельной мысли»)',
    (select target_id = fd3 and emoji = '🔥' from public.reactions
     where target_type = 'fragment' and user_id = d and deleted_at is null));
  perform pg_temp.check('К4.4 слитый кластер — с id старшего, второй погас',
    (select count(*) from public.fragment_clusters where message_id = m and deleted_at is null) = 1
      and (select deleted_at is not null from public.fragment_clusters where id = k2)
      and (select cluster_id from public.message_fragments where id = fd3) = k, s);
  perform pg_temp.check('К4.4 счётчики слитого кластера сходятся', pg_temp.counters_agree(k) = 'ok', pg_temp.counters_agree(k));

  -- Снятая при слиянии не возвращается, если кластер потом разделится.
  snap := pg_temp.take(m);
  s := pg_temp.apply(m, snap, jsonb_build_array(
    pg_temp.cl(m, k, 'какой-то другой уровень общения', true, array[fd2, fe1, fe2]),
    pg_temp.cl(m, null, 'совсем отдельная мысль', true, array[fd3, fc])
  ));
  select count(*) into n from public.reactions where target_type = 'fragment' and user_id = d and deleted_at is null;
  perform pg_temp.check('разделение не возвращает снятую реакцию', n = 1, n::text);

  -- ===================================== К4.3: взаимодействия во время пересчёта
  perform pg_temp.act_as(e);
  perform public.set_fragment_reaction(m, 0, 2, 'Ну', '👍');
  perform pg_temp.as_service();
  snap := pg_temp.take(m);
  perform pg_temp.check('К4.2 второй пересчёт того же сообщения не начинается',
    snap is not null and pg_temp.take(m) is null, snap ->> 'lease');

  -- Пока «модель считает» — реакция и комментарий проходят.
  perform pg_temp.act_as(b);
  fc := pg_temp.react(m, 'другой', '🔥');
  perform pg_temp.act_as(a);
  fe2 := pg_temp.comment_on(m, 'Ну это');
  perform pg_temp.as_service();
  perform pg_temp.check('К4.3 реакция во время пересчёта прошла и сразу в кластере',
    (select cluster_id from public.message_fragments where id = fc) = k);

  s := pg_temp.apply(m, snap, (
    select jsonb_build_array(
      pg_temp.cl(m, k, 'какой-то другой уровень общения', true,
        array(select id from public.message_fragments where message_id = m and deleted_at is null
              and cluster_id = k and id <> fc)),
      pg_temp.cl(m, null, 'Ну', true, array(
        select id from public.message_fragments where message_id = m and deleted_at is null
          and start_offset = 0 and end_offset = 2)),
      pg_temp.cl(m, (select id from public.fragment_clusters where message_id = m and deleted_at is null
                      and start_offset = pg_temp.at(m, 'совсем отдельная мысль')),
        'совсем отдельная мысль', true,
        array(select id from public.message_fragments where message_id = m and deleted_at is null
              and start_offset >= pg_temp.at(m, 'общения,')))
    )
  ));
  select id into k3 from public.fragment_clusters where message_id = m and deleted_at is null and start_offset = 0;
  perform pg_temp.check('К4.3 после записи реакция — в своём кластере',
    s = 'applied' and (select cluster_id from public.message_fragments where id = fc) = k, s);
  perform pg_temp.check('К4.3 фрагмент комментария, которого снимок не видел, — по правилу нового (в «Ну»)',
    (select cluster_id from public.message_fragments where id = fe2) = k3);
  perform pg_temp.check('счётчики после записи сходятся у всех кластеров',
    not exists (select 1 from public.fragment_clusters where message_id = m and deleted_at is null
                and pg_temp.counters_agree(id) <> 'ok'));

  -- ===================================== К4.1: частота пересчёта
  select array_agg(x) into due from generate_series(1, 300) x
  where public.fragment_cluster_recompute_due(x, (public.fragment_cluster_settings()).params);
  perform pg_temp.check('К4.1 пороги: каждое до 20, потом 40, 80, 180, 280',
    due = array(select generate_series(1, 20)) || array[40, 80, 180, 280], due::text);

  -- Кластер на всё сообщение — новые фрагменты сразу в нём, вне порогов
  -- заявок не ставят. Обработчик забирает заявку после каждого раза.
  perform pg_temp.act_as(d);
  perform pg_temp.react(m2, 'это', '🔥');
  perform pg_temp.as_service();
  snap := pg_temp.take(m2);
  perform pg_temp.apply(m2, snap, jsonb_build_array(pg_temp.cl(m2, null,
    'это сообщение для подсчёта взаимодействий', true,
    array(select id from public.message_fragments where message_id = m2))));
  update public.fragment_cluster_state set interactions = 0, queued_at = null where message_id = m2;
  delete from pgmq.q_fragment_clusters where message ->> 'message_id' = m2::text;

  due := '{}';
  for i in 1..45 loop
    perform pg_temp.act_as(d);
    perform pg_temp.react(m2, 'это', emojis[i % 2 + 1]);
    perform pg_temp.as_service();
    if pg_temp.queued(m2) > 0 then
      due := due || i;
      delete from pgmq.q_fragment_clusters where message ->> 'message_id' = m2::text;
      update public.fragment_cluster_state set queued_at = null where message_id = m2;
    end if;
  end loop;
  perform pg_temp.check('К4.1 20 реакций — 20 заявок, 21–39 — ни одной, 40-я — заявка',
    due = array(select generate_series(1, 20)) || array[40], due::text);

  -- Вне порогов новый фрагмент внутри кластера заявки не ставит: он сразу в кластере.
  perform pg_temp.act_as(e);
  perform pg_temp.react(m2, 'сообщение', '👍');
  perform pg_temp.as_service();
  perform pg_temp.check('новый фрагмент внутри кластера вне порогов заявки не ставит',
    pg_temp.queued(m2) = 0 and (select cluster_id is not null from public.message_fragments
                                where message_id = m2 and exact_text = 'сообщение'), pg_temp.queued(m2)::text);

  perform pg_temp.act_as(e);
  perform pg_temp.react(m3, 'начало', '👍');
  perform pg_temp.as_service();
  perform pg_temp.check('К4.1 новый фрагмент без кластера ставит заявку всегда', pg_temp.queued(m3) = 1);

  -- К4.2: заявки одного сообщения схлопываются.
  perform pg_temp.act_as(d);
  perform pg_temp.react(m3, 'конец', '🔥');
  perform pg_temp.react(m3, 'середина', '🤣');
  perform pg_temp.as_service();
  perform pg_temp.check('К4.2 заявки одного сообщения схлопываются', pg_temp.queued(m3) = 1, pg_temp.queued(m3)::text);

  -- ===================================== К4.5: правка теряет фрагмент
  snap := pg_temp.take(m3);
  perform pg_temp.apply(m3, snap, jsonb_build_array(
    pg_temp.cl(m3, null, 'начало', true, array(select id from public.message_fragments where message_id = m3 and start_offset = 0)),
    pg_temp.cl(m3, null, 'середина', false, array(select id from public.message_fragments where message_id = m3 and start_offset = pg_temp.at(m3, 'середина'))),
    pg_temp.cl(m3, null, 'конец', true, array(select id from public.message_fragments where message_id = m3 and start_offset = pg_temp.at(m3, 'конец')))
  ));
  perform pg_temp.act_as(a);
  perform public.edit_message(m3, 'Ну начало отдельно, а конец отдельно', '[]'::jsonb, null);
  perform pg_temp.as_service();
  perform pg_temp.check('К4.5 потерянный при правке фрагмент уходит из кластера',
    (select anchor_state = 'lost' and cluster_id is null from public.message_fragments
     where message_id = m3 and exact_text = 'середина'));
  perform pg_temp.check('К4.5 переехавший фрагмент остался в кластере',
    (select anchor_state = 'shifted' and cluster_id is not null from public.message_fragments
     where message_id = m3 and exact_text = 'начало'));
  perform pg_temp.check('после правки диапазон кластера — по его фрагментам, а не по прежнему тексту',
    (select k.start_offset = 3 and k.end_offset = 9 from public.fragment_clusters k
     join public.message_fragments f on f.cluster_id = k.id
     where f.message_id = m3 and f.exact_text = 'начало'));
  perform pg_temp.check('кластер, потерявший все фрагменты, гаснет',
    (select count(*) from public.fragment_clusters where message_id = m3 and deleted_at is null) = 2);
  perform pg_temp.check('К4.5 до пересчёта прежние диапазоны не показываются, заявка стоит',
    not exists (select 1 from public.fragment_clusters where message_id = m3 and display_start is not null)
      and pg_temp.queued(m3) = 1);
  snap := pg_temp.take(m3);
  perform pg_temp.check('К4.5 потерянный в снимок не идёт',
    not exists (select 1 from jsonb_array_elements(snap -> 'fragments') x
                where (x ->> 'id')::uuid in (select id from public.message_fragments where message_id = m3 and anchor_state = 'lost')),
    snap -> 'fragments' #>> '{}');
  s := pg_temp.apply(m3, snap, jsonb_build_array(
    pg_temp.cl(m3, (select cluster_id from public.message_fragments where message_id = m3 and exact_text = 'начало'), 'начало', true,
      array(select id from public.message_fragments where message_id = m3 and exact_text = 'начало')),
    pg_temp.cl(m3, (select cluster_id from public.message_fragments where message_id = m3 and exact_text = 'конец'), 'конец', true,
      array(select id from public.message_fragments where message_id = m3 and exact_text = 'конец'))
  ));
  perform pg_temp.check('К4.5 после пересчёта отображаемые обновились по новому тексту',
    s = 'applied'
      and (select count(*) from public.fragment_clusters where message_id = m3 and deleted_at is null) = 2
      and (select min(display_start) from public.fragment_clusters where message_id = m3 and deleted_at is null) = 3, s);

  -- Снимок по старому тексту не пишется.
  perform pg_temp.act_as(e);
  perform pg_temp.react(m3, 'отдельно', '🔥');
  perform pg_temp.as_service();
  snap := pg_temp.take(m3);
  perform pg_temp.act_as(a);
  perform public.edit_message(m3, 'Ну начало отдельно, а конец тоже отдельно', '[]'::jsonb, null);
  perform pg_temp.as_service();
  s := public.fragment_clusters_apply(m3, snap || '{"clusters":[]}'::jsonb);
  perform set_config('open.clusters_writer', '', true);
  perform pg_temp.check('результат по тексту до правки выбрасывается, заявка снова в очереди',
    s = 'stale_text' and pg_temp.queued(m3) = 1, s);

  -- ===================================== удалённое сообщение
  perform pg_temp.act_as(a);
  perform public.delete_messages(array[m]);
  perform pg_temp.act_as(e);
  select count(*) into n from public.fragment_clusters where message_id = m;
  perform pg_temp.check('у удалённого сообщения кластеры не читаются', n = 0, n::text);
  perform pg_temp.as_service();
  perform pg_temp.check('удаление сообщения ставит заявку', pg_temp.queued(m) = 1);
  s := pg_temp.apply(m, pg_temp.take(m), '[]'::jsonb);
  perform pg_temp.check('запись по удалённому сообщению гасит кластеры',
    s = 'deleted' and not exists (select 1 from public.fragment_clusters where message_id = m and deleted_at is null), s);
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
