-- Число показываемых кластеров у сообщения (этап 3б): по нему ореол облачка
-- и вход участника в режим фрагментов. Видимый фрагмент без показанного
-- кластера ореола не даёт.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/message_clusters_count_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000aa', 'cca@test.local', '{"full_name":"Участник A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000ba', 'ccb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000da', 'ccd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

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

create function pg_temp.cl(s int, e int, shown boolean, frags uuid[]) returns jsonb
language sql as $$
  select jsonb_build_object(
    'id', null, 'start', s, 'end', e, 'popularity', cardinality(frags),
    'display', case when shown then jsonb_build_object('start', s, 'end', e) end,
    'fragmentIds', to_jsonb(frags)
  )
$$;

create function pg_temp.count_of(m uuid) returns int
language sql as $$ select clusters_count from public.messages where id = m $$;

-- Задержка публикации для зрителей (этап 6) у защитных настроек включена — здесь проверяется не она.
update public.privacy_settings set public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like '%@test.local');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000ba';
  d uuid := '00000000-0000-4000-8000-0000000000da';
  chat uuid;
  m uuid;
  fa uuid;
  fb uuid;
begin
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);
  perform pg_temp.act_as(a);
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, a, 'text', 'abcdefghij klmnopqr stuvwxyzab')
  returning id into m;

  perform pg_temp.act_as(d);
  select fragment_id into fa from public.set_fragment_reaction(m, 0, 10, 'abcdefghij', '🔥');
  select fragment_id into fb from public.set_fragment_reaction(m, 20, 30, 'stuvwxyzab', '👍');

  perform pg_temp.check('видимые фрагменты до пересчёта — ореола нет',
    (select fragments_count from public.messages where id = m) = 2 and pg_temp.count_of(m) = 0,
    pg_temp.count_of(m)::text);

  perform pg_temp.as_service();
  perform pg_temp.apply(m, pg_temp.take(m), jsonb_build_array(
    pg_temp.cl(0, 10, true, array[fa]),
    pg_temp.cl(20, 30, false, array[fb])
  ));
  perform pg_temp.check('считается только показанный кластер', pg_temp.count_of(m) = 1,
    pg_temp.count_of(m)::text);

  -- Пересчёт показал второй и скрыл первый.
  perform public.fragment_clusters_touch(m, false, true);
  perform pg_temp.apply(m, pg_temp.take(m), jsonb_build_array(
    pg_temp.cl(0, 10, false, array[fa]),
    pg_temp.cl(20, 30, true, array[fb])
  ));
  perform pg_temp.check('пересчёт поменял показ — число то же, что показано', pg_temp.count_of(m) = 1,
    pg_temp.count_of(m)::text);

  perform public.fragment_clusters_touch(m, false, true);
  perform pg_temp.apply(m, pg_temp.take(m), jsonb_build_array(
    pg_temp.cl(0, 10, false, array[fa]),
    pg_temp.cl(20, 30, false, array[fb])
  ));
  perform pg_temp.check('модель всё скрыла — ореола нет, хотя фрагменты видимы',
    pg_temp.count_of(m) = 0 and (select fragments_count from public.messages where id = m) = 2,
    pg_temp.count_of(m)::text);

  perform public.fragment_clusters_touch(m, false, true);
  perform pg_temp.apply(m, pg_temp.take(m), jsonb_build_array(
    pg_temp.cl(0, 30, true, array[fa, fb])
  ));
  perform pg_temp.check('слились в один показанный — один', pg_temp.count_of(m) = 1,
    pg_temp.count_of(m)::text);

  perform pg_temp.check('клиент число не пишет',
    not has_column_privilege('authenticated', 'public.messages', 'clusters_count', 'UPDATE'));
end $$;

select n, name, ok, detail from results order by n;

rollback;
