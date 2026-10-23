-- Моя реакция в панели выделенной области (этап 3б): из кластера, куда
-- попадёт мой фрагмент области, по правилу привязки; без кластера — моя на
-- моём фрагменте ровно этой области.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/fragment_area_mine_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a9', 'ama@test.local', '{"full_name":"Участник A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b9', 'amb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d9', 'amd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000e9', 'ame@test.local', '{"full_name":"Посетитель E"}', 'authenticated', 'authenticated');

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
  perform set_config('open.clusters_writer', '', true);
  perform public.fragment_clusters_dedup(m);
  return outcome;
end;
$$;

/** Кластер результата модели: диапазон, показ и фрагменты. */
create function pg_temp.cl(id uuid, s int, e int, frags uuid[]) returns jsonb
language sql as $$
  select jsonb_build_object(
    'id', id, 'start', s, 'end', e, 'popularity', cardinality(frags),
    'display', jsonb_build_object('start', s, 'end', e),
    'fragmentIds', to_jsonb(frags)
  )
$$;

-- Задержка публикации для зрителей (этап 6) у защитных настроек включена — здесь проверяется не она.
update public.privacy_settings set public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like '%@test.local');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a9';
  b uuid := '00000000-0000-4000-8000-0000000000b9';
  d uuid := '00000000-0000-4000-8000-0000000000d9';
  e uuid := '00000000-0000-4000-8000-0000000000e9';
  chat uuid;
  m uuid;
  -- 0–9 abcdefghij, 11–18 klmnopqr, 20–29 stuvwxyzab, дальше — без кластеров.
  body text := 'abcdefghij klmnopqr stuvwxyzab и ещё немного текста в конце';
  snap jsonb;
  k1 uuid;
  k2 uuid;
  fa uuid;
  fe uuid;
  fs uuid;
  fx uuid;
  r record;
begin
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);
  perform pg_temp.act_as(a);
  insert into public.messages (chat_id, author_id, kind, text) values (chat, a, 'text', body)
  returning id into m;

  perform pg_temp.act_as(d);
  select fragment_id into fa from public.set_fragment_reaction(m, 0, 10, 'abcdefghij', '🔥');
  perform pg_temp.act_as(e);
  select fragment_id into fe from public.set_fragment_reaction(m, 20, 30, 'stuvwxyzab', '👍');

  perform pg_temp.as_service();
  snap := pg_temp.take(m);
  perform pg_temp.apply(m, snap, jsonb_build_array(
    pg_temp.cl(null, 0, 19, array[fa]),
    pg_temp.cl(null, 20, 30, array[fe])
  ));
  select id into k1 from public.fragment_clusters where message_id = m and start_offset = 0 and deleted_at is null;
  select id into k2 from public.fragment_clusters where message_id = m and start_offset = 20 and deleted_at is null;

  -- ===================================== К4.5: кластер с наибольшим пересечением
  perform pg_temp.act_as(d);
  select * into r from public.fragment_area_summary(m, 2, 8);
  perform pg_temp.check('область внутри кластера: моя реакция — моя в нём, на другом фрагменте',
    r.my_cluster_id = k1 and r.my_emoji = '🔥' and r.my_fragment_id = fa, r::text);

  -- [15, 28): с K1 пересекается на 4, с K2 — на 8.
  select * into r from public.fragment_area_summary(m, 15, 28);
  perform pg_temp.check('пересекает два кластера — тот, где пересечение больше; моей там нет',
    r.my_cluster_id = k2 and r.my_emoji is null and r.my_fragment_id is null, r::text);

  -- Тап по реакции в панели: база заменяет мою прежнюю в том же кластере.
  perform public.set_fragment_reaction(m, 2, 8, 'cdefgh', '🤣');
  select * into r from public.fragment_area_summary(m, 2, 8);
  perform pg_temp.check('после тапа в области моя в кластере — новая, прежняя снята',
    r.my_cluster_id = k1 and r.my_emoji = '🤣'
      and not exists (
        select 1 from public.reactions x
        where x.target_type = 'fragment' and x.target_id = fa and x.user_id = d and x.deleted_at is null
      ), r::text);

  -- ===================================== К4.5: без кластера — мой фрагмент ровно области
  select * into r from public.fragment_area_summary(m, 33, 40);
  perform pg_temp.check('вне кластеров и без моего фрагмента — ничего моего',
    r.my_cluster_id is null and r.my_emoji is null and r.my_fragment_id is null, r::text);

  select fragment_id into fx from public.set_fragment_reaction(m, 33, 40, substr(body, 34, 7), '👍');
  select * into r from public.fragment_area_summary(m, 33, 40);
  perform pg_temp.check('вне кластеров — моя на моём фрагменте ровно этой области',
    r.my_cluster_id is null and r.my_emoji = '👍' and r.my_fragment_id = fx, r::text);

  select * into r from public.fragment_area_summary(m, 33, 41);
  perform pg_temp.check('область на символ шире — это уже не мой фрагмент',
    r.my_emoji is null and r.my_fragment_id is null, r::text);

  -- ===================================== мой фрагмент области уже в кластере — его кластер
  -- Фрагмент [15, 28) родился в K2 (пересечение больше), пересчёт перенёс его в K1.
  select fragment_id into fs from public.set_fragment_reaction(m, 15, 28, substr(body, 16, 13), '👏');
  perform pg_temp.check('новый фрагмент привязан к кластеру с большим пересечением',
    (select cluster_id from public.message_fragments where id = fs) = k2);

  perform pg_temp.as_service();
  update public.message_fragments set cluster_id = k1 where id = fs;
  perform pg_temp.act_as(d);
  select * into r from public.fragment_area_summary(m, 15, 28);
  perform pg_temp.check('мой фрагмент области уже в кластере — его кластер, а не по пересечению',
    r.my_cluster_id = k1 and r.my_fragment_id is not null, r::text);

  -- ===================================== чужое не видно
  perform pg_temp.act_as(e);
  select * into r from public.fragment_area_summary(m, 2, 8);
  perform pg_temp.check('другой человек видит только своё',
    r.my_cluster_id = k1 and r.my_emoji is null, r::text);
  select * into r from public.fragment_area_summary(m, 20, 30);
  perform pg_temp.check('… и свою реакцию в своём кластере',
    r.my_cluster_id = k2 and r.my_emoji = '👍' and r.my_fragment_id = fe, r::text);

  -- ===================================== удалённое сообщение
  perform pg_temp.as_service();
  update public.messages set deleted_at = now() where id = m;
  perform pg_temp.act_as(d);
  perform pg_temp.check('удалённое сообщение — моего нет',
    not exists (select 1 from public.fragment_area_mine(m, 2, 8)));
end $$;

select n, name, ok, detail from results order by n;

rollback;
