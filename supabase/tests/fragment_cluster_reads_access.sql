-- Кластеры фрагментов (этап 3а): чтение для панелей этапа 3б — отображаемые
-- кластеры сообщения, фрагменты области (больше половины внутри), корни
-- комментариев и закреп набора (кластер, область).
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/fragment_cluster_reads_access.sql
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
  select strpos((select text from public.message_rows where id = m), piece) - 1
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
  body text := 'abcdefghij klmnopqr stuvwxyzab и ещё немного текста в конце';
  snap jsonb;
  k uuid;
  fa uuid;
  fb uuid;
  fx uuid;
  c1 uuid;
  c2 uuid;
  c3 uuid;
  c4 uuid;
  ids uuid[];
  roots uuid[];
  expected uuid[];
  r record;
  n int;
begin
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);
  perform pg_temp.act_as(a);
  m := pg_temp.say(chat, a, body);

  -- ===================================== К6.1: область — больше половины внутри
  perform pg_temp.act_as(d);
  select fragment_id into fa from public.set_fragment_reaction(m, 0, 10, 'abcdefghij', '🔥');
  select fragment_id into fb from public.set_fragment_reaction(m, 20, 30, 'stuvwxyzab', '👍');
  perform pg_temp.act_as(e);
  select fragment_id into fx from public.set_fragment_reaction(m, 11, 19, 'klmnopqr', '👍');

  -- [4, 24): у A внутри 6 из 10, у B — 4 из 10, у X (11–19) — весь.
  ids := array(select public.area_fragment_ids(m, 4, 24));
  perform pg_temp.check('К6.1 область покрывает 60% A — A в выдаче', fa = any (ids), ids::text);
  perform pg_temp.check('К6.1 … 40% B — B нет', not fb = any (ids), ids::text);
  ids := array(select public.area_fragment_ids(m, 5, 24));
  perform pg_temp.check('ровно половина — не входит', not fa = any (ids), ids::text);

  select * into r from public.fragment_area_summary(m, 4, 24);
  perform pg_temp.check('сводка области: фрагменты, реакции, люди, цитата',
    r.fragment_ids = array[fa, fx]
      and r.visitor_reactions = '{"🔥":1,"👍":1}'::jsonb
      and r.reactions_count = 2
      and r.people_count = 2
      and r.area_text = 'efghij klmnopqr stuv', r::text);

  -- ===================================== кластер для К6.2
  perform pg_temp.as_service();
  snap := pg_temp.take(m);
  perform pg_temp.apply(m, snap, jsonb_build_array(
    jsonb_build_object('id', null, 'start', 0, 'end', 19, 'popularity', 3,
      'display', jsonb_build_object('start', 0, 'end', 19), 'fragmentIds', jsonb_build_array(fa, fx)),
    jsonb_build_object('id', null, 'start', 20, 'end', 30, 'popularity', 1,
      'display', jsonb_build_object('start', 20, 'end', 30), 'fragmentIds', jsonb_build_array(fb))
  ));
  select id into k from public.fragment_clusters where message_id = m and start_offset = 0 and deleted_at is null;

  perform pg_temp.act_as(d);
  select count(*) into n from public.list_message_clusters(m);
  select * into r from public.list_message_clusters(m) where id = k;
  perform pg_temp.check('отображаемые кластеры сообщения: цитата, счётчики, моя реакция',
    n = 2 and r.display_text = 'abcdefghij klmnopqr' and r.reactions_count = 2 and r.people_count = 2
      and r.fragments_count = 2 and r.my_emoji = '🔥' and r.my_fragment_id = fa, r::text);
  perform pg_temp.act_as(b);
  perform pg_temp.check('у того, кто не голосовал, моей реакции в кластере нет',
    (select my_emoji is null from public.list_message_clusters(m) where id = k));
  perform pg_temp.check('фрагменты сообщения знают свой кластер',
    (select cluster_id from public.list_message_fragments(m) where id = fa) = k);

  -- ===================================== К6.2: корни кластера
  perform pg_temp.act_as(b);
  c1 := public.send_comment(m, 'к A', '[]'::jsonb, null, null, jsonb_build_object('id', fa));
  c2 := public.send_comment(m, 'к X', '[]'::jsonb, null, null, jsonb_build_object('id', fx));
  perform pg_temp.act_as(e);
  c3 := public.send_comment(m, 'ещё к A', '[]'::jsonb, null, null, jsonb_build_object('id', fa));
  c4 := public.send_comment(m, 'к B — другой кластер', '[]'::jsonb, null, null, jsonb_build_object('id', fb));
  perform public.send_comment(m, 'просто к сообщению');

  -- Ранги разные (ранг — из реакций): порядок проверяем по рангу, а не по времени.
  perform pg_temp.as_service();
  update public.comments set reactions_count = 5 where id = c2;
  update public.comments set reactions_count = 3 where id = c3;
  update public.comments set reactions_count = 1 where id = c1;

  perform pg_temp.act_as(a);
  perform public.pin_comment(c3);

  perform pg_temp.act_as(d);
  roots := array(select id from public.list_comment_thread_roots(m, cluster => k));
  expected := array(
    select c.id from public.comments c
    where c.fragment_id in (fa, fx) and c.thread_root_id is null and c.deleted_at is null
    order by c.rank desc, c.id desc
  );
  perform pg_temp.check('К6.2 корни кластера = корни всех его фрагментов, по рангу',
    roots = expected and roots = array[c2, c3, c1], roots::text);
  perform pg_temp.check('К6.2 … без чужого кластера и без комментариев к сообщению целиком',
    not c4 = any (roots) and cardinality(roots) = 3, roots::text);
  perform pg_temp.check('К6.2 закреп кластера — закреплённый из его фрагментов',
    (select id from public.pinned_comment(m, cluster => k)) = c3);
  perform pg_temp.check('закреп не из набора не отдаётся',
    not exists (select 1 from public.pinned_comment(m, cluster => (
      select id from public.fragment_clusters where message_id = m and start_offset = 20 and deleted_at is null))));
  perform pg_temp.check('закреп цели без набора — как раньше',
    (select id from public.pinned_comment(m)) = c3);
  roots := array(select id from public.list_comment_thread_roots(m, area_start => 4, area_end => 24));
  perform pg_temp.check('корни области — фрагменты A и X', roots = array[c2, c3, c1], roots::text);
  roots := array(select id from public.list_comment_thread_roots(m, fragment => fa));
  perform pg_temp.check('корни одного фрагмента — как в этапе 1', roots = array[c3, c1], roots::text);
  select count(*) into n from public.list_comment_thread_roots(m);
  perform pg_temp.check('без набора — все корни сообщения', n = 5, n::text);
  roots := array(select id from public.list_comment_thread_roots(m, after_rank => (select rank from public.comments where id = c2), after_id => c2, cluster => k));
  perform pg_temp.check('страницы ранга в кластере', roots = array[c3, c1], roots::text);
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
