-- Лидер кластера (цвет подсветки): правило лидера, ничья держит прежнего,
-- порядок справочника без прежнего, снятие всех реакций, посетитель наравне
-- с участником, пересчёт модели с наследованием id не сбрасывает лидера.
-- Те же случаи — в `src/features/chats/fragments/reactionStyle.test.ts`.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/fragment_cluster_dominant.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000aa', 'la@test.local', '{"full_name":"Участник A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000ba', 'lb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000da', 'ld@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000ea', 'le@test.local', '{"full_name":"Посетитель E"}', 'authenticated', 'authenticated');

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

create function pg_temp.say_text(chat uuid, body text) returns uuid
language plpgsql as $$
declare
  id uuid;
begin
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, auth.uid(), 'text', body)
  returning messages.id into id;
  return id;
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

create function pg_temp.cl(m uuid, id uuid, piece text, frags uuid[]) returns jsonb
language sql as $$
  select jsonb_build_object(
    'id', id,
    'start', pg_temp.at(m, piece),
    'end', pg_temp.at(m, piece) + char_length(piece),
    'popularity', cardinality(frags),
    'display', jsonb_build_object('start', pg_temp.at(m, piece), 'end', pg_temp.at(m, piece) + char_length(piece)),
    'fragmentIds', to_jsonb(frags)
  )
$$;

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

/** Лидер по сводке, без прежнего. */
create function pg_temp.lead(member jsonb, visitor jsonb default '{}', previous text default null) returns text
language sql as $$ select public.cluster_dominant_reaction(member, visitor, previous) $$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000ba';
  d uuid := '00000000-0000-4000-8000-0000000000da';
  e uuid := '00000000-0000-4000-8000-0000000000ea';
  chat uuid;
  m2 uuid;
  m3 uuid;
  f5 uuid;
  f1 uuid;
  f2 uuid;
  f3 uuid;
  f4 uuid;
  m uuid;
  k uuid;
  fa uuid;
  fd uuid;
  s text;
  got text;
begin
  -- ==================================================== правило по сводке
  perform pg_temp.check('К1.1 ❤️24 👍15 🔥8 → ❤️',
    pg_temp.lead('{"❤️":24,"👍":15,"🔥":8}') = '❤️');
  perform pg_temp.check('К1.1 ❤️12 👍19 🔥5 → 👍',
    pg_temp.lead('{"❤️":12,"👍":19,"🔥":5}') = '👍');
  perform pg_temp.check('ряды участников и посетителей складываются',
    pg_temp.lead('{"❤️":3,"👍":2}', '{"👍":2}') = '👍');
  perform pg_temp.check('К1.2 ничья держит прежнего',
    pg_temp.lead('{"❤️":2,"👍":2}', '{}', '❤️') = '❤️'
      and pg_temp.lead('{"❤️":2,"👍":2}', '{}', '👍') = '👍');
  perform pg_temp.check('К1.3 ничья без прежнего — порядок справочника, одинаково при повторе',
    pg_temp.lead('{"🔥":2,"❤️":2}') = '❤️' and pg_temp.lead('{"❤️":2,"🔥":2}') = '❤️'
      and pg_temp.lead('{"😮":1,"😂":1}') = '😂');
  perform pg_temp.check('прежний не в максимуме — уступает',
    pg_temp.lead('{"❤️":2,"👍":3}', '{}', '❤️') = '👍');
  perform pg_temp.check('К1.4 реакций нет — null',
    pg_temp.lead('{}') is null and pg_temp.lead('{}', '{}', '❤️') is null);

  -- ================================================ живые кластеры, триггер
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b], null) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);
  perform pg_temp.act_as(a);
  m := pg_temp.say_text(chat, 'Сначала совсем другой уровень общения, а дальше мысль');

  fa := pg_temp.react(m, 'другой уровень', '❤️');
  perform pg_temp.as_service();
  s := pg_temp.recompute(m, jsonb_build_array(pg_temp.cl(m, null, 'другой уровень', array[fa])));
  select id, dominant_emoji into k, got from public.fragment_clusters where message_id = m and deleted_at is null;
  perform pg_temp.check('новый кластер считает лидера с нуля', s = 'applied' and got = '❤️', s || ' ' || coalesce(got, 'null'));

  -- Посетитель D ставит 👍 на кусок внутри кластера: ничья 1:1.
  perform pg_temp.act_as(d);
  fd := pg_temp.react(m, 'уровень', '👍');
  perform pg_temp.as_service();
  select dominant_emoji into got from public.fragment_clusters where id = k;
  perform pg_temp.check('К1.2 ничья ❤️1 👍1 (посетитель) — лидер остаётся ❤️',
    got = '❤️'
      and (select (member_reactions ->> '❤️')::int = 1 and (visitor_reactions ->> '👍')::int = 1
           from public.fragment_clusters where id = k),
    coalesce(got, 'null'));

  -- К1.5: пересчёт с наследованием id. Без прежнего ничья ушла бы 👍 (позиция 1).
  s := pg_temp.recompute(m, jsonb_build_array(pg_temp.cl(m, k, 'другой уровень', array[fa, fd])));
  select dominant_emoji into got from public.fragment_clusters where id = k and deleted_at is null;
  perform pg_temp.check('К1.5 apply с наследованием id не сбрасывает лидера в ничьей',
    s = 'applied' and got = '❤️', s || ' ' || coalesce(got, 'null'));

  perform pg_temp.act_as(d);
  perform pg_temp.check('лидер виден в list_message_clusters и посетителю',
    (select c.dominant_emoji from public.list_message_clusters(m) c where c.id = k) = '❤️');

  -- Тот же кластер, но новый id — прежнего нет: ничья по справочнику.
  perform pg_temp.as_service();
  s := pg_temp.recompute(m, jsonb_build_array(pg_temp.cl(m, null, 'другой уровень', array[fa, fd])));
  select dominant_emoji into got from public.fragment_clusters where message_id = m and deleted_at is null;
  perform pg_temp.check('К1.3 новый кластер в ничьей — по порядку справочника (👍)',
    s = 'applied' and got = '👍', s || ' ' || coalesce(got, 'null'));
  select id into k from public.fragment_clusters where message_id = m and deleted_at is null;

  -- Триггер по рядам: прямая правка сводки (так её меняют счётчики).
  update public.fragment_clusters set member_reactions = '{"❤️":2}', visitor_reactions = '{"👍":2}' where id = k;
  select dominant_emoji into got from public.fragment_clusters where id = k;
  perform pg_temp.check('К1.2 сравнялись — лидер остаётся 👍', got = '👍', got);
  update public.fragment_clusters set member_reactions = '{"❤️":3}' where id = k;
  select dominant_emoji into got from public.fragment_clusters where id = k;
  perform pg_temp.check('К1.2 ❤️ обогнал строго — лидер ❤️', got = '❤️', got);
  update public.fragment_clusters set member_reactions = '{"❤️":2}' where id = k;
  select dominant_emoji into got from public.fragment_clusters where id = k;
  perform pg_temp.check('К1.2 снова ничья — лидер остаётся ❤️', got = '❤️', got);
  update public.fragment_clusters set dominant_emoji = '🔥' where id = k;
  select dominant_emoji into got from public.fragment_clusters where id = k;
  perform pg_temp.check('лидера не подделать прямой записью', got = '❤️', got);

  -- К1.4: все реакции сняты на живых фрагментах.
  perform pg_temp.act_as(a);
  perform public.set_fragment_reaction(m, pg_temp.at(m, 'другой уровень'),
    pg_temp.at(m, 'другой уровень') + char_length('другой уровень'), 'другой уровень', null);
  perform pg_temp.act_as(d);
  perform public.set_fragment_reaction(m, pg_temp.at(m, 'уровень'),
    pg_temp.at(m, 'уровень') + char_length('уровень'), 'уровень', null);
  perform pg_temp.as_service();
  perform public.refresh_message_clusters(m);
  select dominant_emoji into got from public.fragment_clusters where id = k;
  perform pg_temp.check('К1.4 все реакции сняты — лидер null', got is null, coalesce(got, 'null'));

  -- Замена моей реакции внутри кластера (снять прежнюю + поставить новую) —
  -- одно действие: ничья сравнивается с лидером до замены, а не с промежуточным.
  perform pg_temp.act_as(a);
  m2 := pg_temp.say_text(chat, 'Здесь первый кусок и второй кусок рядом');
  f1 := pg_temp.react(m2, 'первый кусок', '👍');
  perform pg_temp.act_as(b);
  f2 := pg_temp.react(m2, 'кусок и', '👍');
  perform pg_temp.act_as(d);
  f3 := pg_temp.react(m2, 'и второй', '❤️');
  perform pg_temp.act_as(e);
  f4 := pg_temp.react(m2, 'второй кусок', '❤️');
  perform pg_temp.as_service();
  s := pg_temp.recompute(m2, jsonb_build_array(pg_temp.cl(m2, null, 'первый кусок и второй кусок', array[f1, f2, f3, f4])));
  select id, dominant_emoji into k, got from public.fragment_clusters where message_id = m2 and deleted_at is null;
  perform pg_temp.check('ничья 👍2 ❤️2 без прежнего — 👍 по справочнику', s = 'applied' and got = '👍', s || ' ' || coalesce(got, 'null'));

  perform pg_temp.act_as(a);
  perform pg_temp.react(m2, 'первый', '👍');
  perform pg_temp.as_service();
  select dominant_emoji into got from public.fragment_clusters where id = k;
  perform pg_temp.check('перенос моей 👍 на другой кусок кластера не отдаёт лидера ❤️',
    got = '👍'
      and (select (member_reactions ->> '👍')::int = 2 and (visitor_reactions ->> '❤️')::int = 2
           from public.fragment_clusters where id = k),
    coalesce(got, 'null') || ' ' || (select member_reactions::text || visitor_reactions::text from public.fragment_clusters where id = k));

  -- Снятие дублей после слияния кластеров (dedup) пересчитывает лидера:
  -- у A и B по ❤️ (раньше) и 👍 (позже) в одном кластере, у D — ❤️.
  perform pg_temp.act_as(a);
  m3 := pg_temp.say_text(chat, 'альфа бета гамма дельта');
  f1 := pg_temp.react(m3, 'альфа', '❤️');
  f3 := pg_temp.react(m3, 'гамма', '👍');
  perform pg_temp.act_as(b);
  f2 := pg_temp.react(m3, 'бета', '❤️');
  f4 := pg_temp.react(m3, 'дельта', '👍');
  perform pg_temp.act_as(d);
  f5 := pg_temp.react(m3, 'альфа бета', '❤️');
  perform pg_temp.as_service();
  update public.reactions set updated_at = updated_at - interval '1 hour'
  where target_type = 'fragment' and target_id in (f1, f2) and deleted_at is null;
  s := pg_temp.recompute(m3, jsonb_build_array(pg_temp.cl(m3, null, 'альфа бета гамма дельта', array[f1, f2, f3, f4, f5])));
  select id, dominant_emoji into k, got from public.fragment_clusters where message_id = m3 and deleted_at is null;
  perform pg_temp.check('слияние с дублями: ❤️3 👍2 — ❤️', s = 'applied' and got = '❤️', s || ' ' || coalesce(got, 'null'));
  perform public.fragment_clusters_dedup(m3);
  select dominant_emoji into got from public.fragment_clusters where id = k;
  perform pg_temp.check('dedup снял старые ❤️ (❤️1 👍2) — лидер 👍',
    got = '👍',
    coalesce(got, 'null') || ' ' || (select member_reactions::text || visitor_reactions::text from public.fragment_clusters where id = k));
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
