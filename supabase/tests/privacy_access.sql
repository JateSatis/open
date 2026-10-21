-- Приватность, этап 1: дата рождения, настройки, друзья, видимость списка
-- друзей. Разрешённые и запрещённые пути.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/privacy_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

-- К1.7: существующие аккаунты засеяны до появления тестовых.
select pg_temp.check(
  'К1.7 у всех существующих аккаунтов дата 13–40 лет и отметка инициализации',
  not exists (
    select 1 from public.profiles p
    left join public.privacy_settings s on s.user_id = p.id
    where s.birth_date is null
      or s.initialized_at is null
      or public.age_in_years(s.birth_date) not between 13 and 40
  ),
  (select count(*)::text from public.profiles)
);

select pg_temp.check(
  'К1.7 настройки засеянных — по их возрасту',
  not exists (
    select 1 from public.privacy_settings s
    where s.friends_list_visibility
      <> case when public.age_in_years(s.birth_date) < 18 then 'nobody' else 'everyone' end
       or s.avatar_visibility
      <> case when public.age_in_years(s.birth_date) < 18 then 'friends' else 'everyone' end
  )
);

insert into auth.users (id, email, raw_user_meta_data, aud, role, created_at) values
  ('00000000-0000-4000-8000-0000000001a1', 'pa@test.local', '{"full_name":"Тест A"}', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000001b1', 'pb@test.local', '{"full_name":"Тест B"}', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000001c1', 'pc@test.local', '{"full_name":"Тест C"}', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000001d1', 'pd@test.local', '{"full_name":"Тест D"}', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000001e1', 'pe@test.local', '{"full_name":"Брошенный"}', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000001f1', 'pf@test.local', '{"full_name":"Без даты, но живой"}', 'authenticated', 'authenticated', now());

-- У F живой сеанс: без даты, но приложением пользуется.
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000001f1', now(), now());

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.settings_of(uid uuid) returns jsonb language sql as $$
  select to_jsonb(s) - 'id' - 'user_id' - 'birth_date' - 'initialized_at' - 'created_at' - 'updated_at'
  from public.privacy_settings s where s.user_id = uid
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000001a1';
  b uuid := '00000000-0000-4000-8000-0000000001b1';
  c uuid := '00000000-0000-4000-8000-0000000001c1';
  d uuid := '00000000-0000-4000-8000-0000000001d1';
  e uuid := '00000000-0000-4000-8000-0000000001e1';
  f uuid := '00000000-0000-4000-8000-0000000001f1';
  age15 date := (current_date - interval '15 years' - interval '10 days')::date;
  age25 date := (current_date - interval '25 years' - interval '10 days')::date;
  age12 date := (current_date - interval '12 years' - interval '10 days')::date;
  minor jsonb := public.privacy_default_settings(true);
  adult jsonb := public.privacy_default_settings(false);
  before jsonb;
  s text;
  n int;
  ok boolean;
  r jsonb;
begin
  -- ===================================================== К1.1 новый аккаунт
  perform pg_temp.check(
    'К1.1 новый аккаунт сразу с защитными значениями и без даты',
    pg_temp.settings_of(a) = minor
      and (select birth_date is null and initialized_at is null from public.privacy_settings where user_id = a),
    pg_temp.settings_of(a)::text
  );

  -- ===================================================== К1.2 15 лет
  perform pg_temp.act_as(a);
  r := public.set_birth_date(age15);
  perform pg_temp.act_as_postgres();
  perform pg_temp.check('К1.2 первая установка отмечена', (r ->> 'initialized')::boolean, r::text);
  perform pg_temp.check(
    'К1.2 15 лет → защитный набор',
    pg_temp.settings_of(a) = minor
      and minor ->> 'avatar_visibility' = 'friends'
      and minor ->> 'friends_list_visibility' = 'nobody'
      and (minor ->> 'uploaded_media_metadata_stripping')::boolean
      and minor ->> 'incoming_dialogue_requests' = 'requests_only'
      and minor ->> 'dialogue_hidden_text_visibility' = 'enabled'
      and minor ->> 'public_message_visibility_delay' = 'random_delay',
    pg_temp.settings_of(a)::text
  );

  -- ===================================================== К1.3 25 лет
  perform pg_temp.act_as(b);
  perform public.set_birth_date(age25);
  perform pg_temp.act_as_postgres();
  perform pg_temp.check(
    'К1.3 25 лет → стандартный набор',
    pg_temp.settings_of(b) = adult
      and adult ->> 'profile_identity_masking' = 'everyone'
      and adult ->> 'friends_list_visibility' = 'everyone'
      and not (adult ->> 'uploaded_media_metadata_stripping')::boolean
      and adult ->> 'incoming_dialogue_requests' = 'off'
      and adult ->> 'dialogue_hidden_text_visibility' = 'disabled'
      and adult ->> 'public_message_visibility_delay' = 'off',
    pg_temp.settings_of(b)::text
  );

  -- ===================================================== К1.4 повтор
  perform pg_temp.act_as(a);
  r := public.set_birth_date(age25);
  perform pg_temp.act_as_postgres();
  perform pg_temp.check(
    'К1.4 15 → 25: дата сменилась, настройки нет',
    pg_temp.settings_of(a) = minor and not (r ->> 'initialized')::boolean
      and (select birth_date from public.privacy_settings where user_id = a) = age25,
    r::text
  );

  perform pg_temp.act_as(b);
  perform public.set_birth_date(age15);
  perform pg_temp.act_as_postgres();
  perform pg_temp.check('К1.4 25 → 15: настройки нет', pg_temp.settings_of(b) = adult);

  -- ===================================================== К1.5 отказы
  perform pg_temp.act_as(b);
  begin
    perform public.set_birth_date(public.latest_local_date() + 1);
    perform pg_temp.check('К1.5 дата в будущем отклонена', false, 'прошло');
  exception when others then perform pg_temp.check('К1.5 дата в будущем отклонена (OPN03)', sqlstate = 'OPN03', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.set_birth_date(age12);
    perform pg_temp.check('К1.5 12 лет отклонено', false, 'прошло');
  exception when others then perform pg_temp.check('К1.5 12 лет отклонено (OPN04)', sqlstate = 'OPN04', sqlstate || ' ' || sqlerrm);
  end;
  perform pg_temp.act_as_postgres();
  perform pg_temp.check(
    'К1.5 после отказов дата прежняя',
    (select birth_date from public.privacy_settings where user_id = b) = age15
  );

  -- Ровно 13 сегодня — можно; 12 у нового аккаунта не инициализирует его.
  perform pg_temp.act_as(c);
  begin
    perform public.set_birth_date(age12);
  exception when others then null;
  end;
  perform pg_temp.act_as_postgres();
  perform pg_temp.check(
    'К1.5 отказ первой даты не сохраняет ни даты, ни настроек',
    (select birth_date is null and initialized_at is null from public.privacy_settings where user_id = c)
      and pg_temp.settings_of(c) = minor
  );
  perform pg_temp.act_as(c);
  begin
    perform public.set_birth_date((public.latest_local_date() - interval '13 years')::date + 1);
    perform pg_temp.check('13 лет только завтра и по самому позднему поясу — отказ', false, 'прошло');
  exception when others then perform pg_temp.check('13 лет только завтра и по самому позднему поясу — отказ', sqlstate = 'OPN04', sqlstate);
  end;
  -- 13 исполняется сегодня где-то на Земле (UTC+14) — принято, хотя в UTC
  -- может быть ещё вчера.
  perform public.set_birth_date((public.latest_local_date() - interval '13 years')::date);
  perform pg_temp.act_as_postgres();
  perform pg_temp.check(
    'ровно 13 по самому позднему поясу — принято, подростковый набор',
    pg_temp.settings_of(c) = minor
      and (select initialized_at is not null from public.privacy_settings where user_id = c)
  );

  -- 25-летний D, для ролей ниже.
  perform pg_temp.act_as(d);
  perform public.set_birth_date(age25);

  -- ===================================================== К1.6 чужое
  perform pg_temp.act_as(c);
  select count(*) into n from public.privacy_settings where user_id <> c;
  perform pg_temp.check('К1.6 чужие строки не читаются прямым запросом', n = 0, n::text);
  select count(*) into n from public.privacy_settings;
  perform pg_temp.check('К1.6 своя строка читается', n = 1, n::text);
  perform pg_temp.check('К1.6 RPC отдаёт только свою', (public.my_privacy_settings()).user_id = c);

  begin
    update public.privacy_settings set friends_list_visibility = 'everyone' where user_id = a;
    perform pg_temp.check('К1.6 чужая строка не меняется UPDATE', false, 'прошло');
  exception when others then perform pg_temp.check('К1.6 чужая строка не меняется UPDATE', sqlstate = '42501', sqlstate);
  end;

  begin
    update public.privacy_settings set friends_list_visibility = 'everyone' where user_id = c;
    perform pg_temp.check('К1.6 своя строка не меняется прямым UPDATE', false, 'прошло');
  exception when others then perform pg_temp.check('К1.6 своя строка не меняется прямым UPDATE', sqlstate = '42501', sqlstate);
  end;

  begin
    insert into public.privacy_settings select * from public.privacy_settings_row(gen_random_uuid(), false);
    perform pg_temp.check('К1.6 строка не создаётся с клиента', false, 'прошло');
  exception when others then perform pg_temp.check('К1.6 строка не создаётся с клиента', sqlstate = '42501', sqlstate);
  end;

  begin
    perform public.privacy_allows('friends_list_visibility', a, b);
    perform pg_temp.check('privacy_allows закрыта для клиента', false, 'прошло');
  exception when others then perform pg_temp.check('privacy_allows закрыта для клиента', sqlstate = '42501', sqlstate);
  end;

  begin
    perform public.set_privacy_setting('friends_list_visibility', 'all');
    perform pg_temp.check('К1.6 недопустимое значение отклонено', false, 'прошло');
  exception when others then perform pg_temp.check('К1.6 недопустимое значение отклонено', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.set_privacy_setting('birth_date', '2000-01-01');
    perform pg_temp.check('К1.6 дата не меняется через настройку', false, 'прошло');
  exception when others then perform pg_temp.check('К1.6 дата не меняется через настройку', sqlstate = '22023', sqlstate);
  end;

  begin
    perform public.set_privacy_setting('uploaded_media_metadata_stripping', 'maybe');
    perform pg_temp.check('булева настройка не берёт мусор', false, 'прошло');
  exception when others then perform pg_temp.check('булева настройка не берёт мусор', sqlstate = '22023', sqlstate);
  end;

  perform public.set_privacy_setting('uploaded_media_metadata_stripping', 'false');
  perform public.set_privacy_setting('friends_list_visibility', 'everyone');
  perform pg_temp.act_as_postgres();
  perform pg_temp.check(
    'своя настройка меняется функцией',
    (select friends_list_visibility = 'everyone' and not uploaded_media_metadata_stripping
     from public.privacy_settings where user_id = c)
  );
  perform pg_temp.check(
    'чужая строка от этого не изменилась',
    (select friends_list_visibility from public.privacy_settings where user_id = a) = 'nobody'
  );

  perform pg_temp.act_as_postgres();
  perform set_config('role', 'anon', true);
  begin
    perform public.my_privacy_settings();
    perform pg_temp.check('anon не зовёт my_privacy_settings', false, 'прошло');
  exception when others then perform pg_temp.check('anon не зовёт my_privacy_settings', sqlstate = '42501', sqlstate);
  end;
  perform pg_temp.act_as_postgres();

  -- ===================================================== Друзья
  -- К4.1: A зовёт B.
  perform pg_temp.act_as(a);
  s := public.send_friend_request(b);
  perform pg_temp.check('К4.1 заявка → outgoing', s = 'outgoing', s);
  perform pg_temp.check('К4.1 у A статус outgoing', public.friendship_status(b) = 'outgoing');
  perform pg_temp.check('К4.7 заявка не делает друзьями (A→B)', not exists (
    select 1 from public.list_friends(a)));

  perform pg_temp.act_as(b);
  perform pg_temp.check('К4.1 у B входящая', public.friendship_status(a) = 'incoming');
  perform pg_temp.check('К4.1 у B счётчик 1', (public.friends_summary(b) ->> 'incoming_count')::int = 1);
  perform pg_temp.check('К4.1 у B в заявках A',
    (select array_agg(user_id) from public.list_incoming_friend_requests()) = array[a]);
  perform pg_temp.check('К4.7 заявка не делает друзьями (B)', not exists (
    select 1 from public.list_friends(b)));
  perform pg_temp.act_as_postgres();
  perform pg_temp.check('К4.7 are_friends ложь при заявке', not public.are_friends(a, b));
  perform pg_temp.act_as(a);

  -- К4.6: посторонний C.
  perform pg_temp.act_as(c);
  begin
    select count(*) into n from public.friendships;
    perform pg_temp.check('К4.6 C не читает таблицу дружб', false, n::text);
  exception when others then perform pg_temp.check('К4.6 C не читает таблицу дружб', sqlstate = '42501', sqlstate);
  end;

  perform pg_temp.check('К4.6 входящие C пусты (чужие не видны)', not exists (
    select 1 from public.list_incoming_friend_requests()));
  s := public.accept_friend_request(a);
  perform pg_temp.act_as_postgres();
  perform pg_temp.check('К4.6 C не принимает чужую заявку A→B',
    (select status from public.friendships where requester_id = a and addressee_id = b) = 'pending', s);
  perform pg_temp.act_as(c);
  begin
    insert into public.friendships (requester_id, addressee_id, status, accepted_at)
    values (a, b, 'accepted', now());
    perform pg_temp.check('К4.6 C не вставляет дружбу напрямую', false, 'прошло');
  exception when others then perform pg_temp.check('К4.6 C не вставляет дружбу напрямую', sqlstate in ('42501', '23505'), sqlstate);
  end;
  begin
    update public.friendships set status = 'accepted', accepted_at = now();
    perform pg_temp.check('К4.6 C не меняет дружбы напрямую', false, 'прошло');
  exception when others then perform pg_temp.check('К4.6 C не меняет дружбы напрямую', sqlstate = '42501', sqlstate);
  end;
  begin
    perform public.are_friends(a, b);
    perform pg_temp.check('are_friends закрыта для клиента', false, 'прошло');
  exception when others then perform pg_temp.check('are_friends закрыта для клиента', sqlstate = '42501', sqlstate);
  end;

  -- К4.3: B отклоняет.
  perform pg_temp.act_as(b);
  s := public.decline_friend_request(a);
  perform pg_temp.check('К4.3 после отказа у B — none', s = 'none', s);
  perform pg_temp.check('К4.3 у B заявок нет', (public.friends_summary(b) ->> 'incoming_count')::int = 0);
  perform pg_temp.act_as(a);
  perform pg_temp.check('К4.3 у A по-прежнему outgoing', public.friendship_status(b) = 'outgoing');
  s := public.send_friend_request(b);
  perform pg_temp.check('К4.3 повтор у A — outgoing', s = 'outgoing', s);
  perform pg_temp.act_as(b);
  perform pg_temp.check('К4.3 повтор не тревожит B', not exists (select 1 from public.list_incoming_friend_requests()));
  perform pg_temp.act_as(a);
  -- Отмена и новая заявка после отказа тоже не тревожат.
  s := public.cancel_friend_request(b);
  perform pg_temp.check('отмена отклонённой → none у A', s = 'none' and public.friendship_status(b) = 'none', s);
  s := public.send_friend_request(b);
  perform pg_temp.act_as(b);
  perform pg_temp.check('отменил и позвал снова — B не тревожится', not exists (select 1 from public.list_incoming_friend_requests()));
  -- B передумал: «Добавить» принимает заявку A.
  s := public.send_friend_request(a);
  perform pg_temp.check('B передумал после отказа → friends', s = 'friends', s);

  -- К4.2: оба видят друг друга.
  perform pg_temp.check('К4.2 у B — friends', public.friendship_status(a) = 'friends');
  perform pg_temp.check('К4.2 B видит A в друзьях',
    (select array_agg(user_id) from public.list_friends(b)) = array[a]);
  perform pg_temp.act_as(a);
  perform pg_temp.check('К4.2 у A — friends', public.friendship_status(b) = 'friends');
  perform pg_temp.check('К4.2 A видит B в друзьях (свой список всегда, К5.6)',
    (select array_agg(user_id) from public.list_friends(a)) = array[b]);

  -- ===================================================== К5: видимость списка B
  -- B взрослый — по умолчанию «Все».
  perform pg_temp.act_as(c);
  perform pg_temp.check('К5.5 «Все»: C видит список B', exists (select 1 from public.list_friends(b))
    and (public.friends_summary(b) ->> 'list_visible')::boolean);
  perform pg_temp.check('счётчик друзей B для C', (public.friends_summary(b) ->> 'friends_count')::int = 1);
  perform pg_temp.check('C не видит чужих входящих', public.friends_summary(b) ->> 'incoming_count' is null);
  perform pg_temp.act_as(a);
  perform pg_temp.check('К5.5 «Все»: A видит список B', exists (select 1 from public.list_friends(b)));

  perform pg_temp.act_as(b);
  perform public.set_privacy_setting('friends_list_visibility', 'friends');
  perform pg_temp.act_as(a);
  perform pg_temp.check('К5.4 «Только друзья»: A видит', exists (select 1 from public.list_friends(b)));
  perform pg_temp.act_as(c);
  perform pg_temp.check('К5.4 «Только друзья»: строка C скрыта',
    not (public.friends_summary(b) ->> 'list_visible')::boolean
      and public.friends_summary(b) ->> 'friends_count' is null);
  begin
    perform public.list_friends(b);
    perform pg_temp.check('К5.4 «Только друзья»: C отказ', false, 'прошло');
  exception when others then perform pg_temp.check('К5.4 «Только друзья»: C отказ', sqlstate = '42501', sqlstate);
  end;

  perform pg_temp.act_as(b);
  perform public.set_privacy_setting('friends_list_visibility', 'nobody');
  perform pg_temp.check('К5.6 «Никто»: B видит свой', exists (select 1 from public.list_friends(b))
    and (public.friends_summary(b) ->> 'list_visible')::boolean);
  perform pg_temp.act_as(a);
  begin
    perform public.list_friends(b);
    perform pg_temp.check('К5.3 «Никто»: друг A отказ', false, 'прошло');
  exception when others then perform pg_temp.check('К5.3 «Никто»: друг A отказ', sqlstate = '42501', sqlstate);
  end;
  perform pg_temp.check('К5.3 «Никто»: строка A скрыта', not (public.friends_summary(b) ->> 'list_visible')::boolean);
  perform pg_temp.act_as(c);
  begin
    perform public.list_friends(b);
    perform pg_temp.check('К5.3 «Никто»: C отказ', false, 'прошло');
  exception when others then perform pg_temp.check('К5.3 «Никто»: C отказ', sqlstate = '42501', sqlstate);
  end;

  -- Подросток A: список по умолчанию «Никто».
  perform pg_temp.act_as(b);
  begin
    perform public.list_friends(a);
    perform pg_temp.check('подросток по умолчанию прячет список и от друга', false, 'прошло');
  exception when others then perform pg_temp.check('подросток по умолчанию прячет список и от друга', sqlstate = '42501', sqlstate);
  end;

  -- К4.5: A удаляет B.
  perform pg_temp.act_as(a);
  s := public.remove_friend(b);
  perform pg_temp.check('К4.5 у A — none', s = 'none' and public.friendship_status(b) = 'none', s);
  perform pg_temp.check('К4.5 B нет в списке A', not exists (select 1 from public.list_friends(a)));
  perform pg_temp.act_as(b);
  perform pg_temp.check('К4.5 у B — none', public.friendship_status(a) = 'none');
  perform pg_temp.check('К4.5 A нет в списке B', not exists (select 1 from public.list_friends(b)));

  -- К4.4: встречные заявки C ↔ D.
  perform pg_temp.act_as(c);
  s := public.send_friend_request(d);
  perform pg_temp.act_as(d);
  s := public.send_friend_request(c);
  perform pg_temp.check('К4.4 встречная → friends', s = 'friends', s);
  perform pg_temp.check('К4.4 лишних заявок нет', not exists (select 1 from public.list_incoming_friend_requests()));
  perform pg_temp.act_as(c);
  perform pg_temp.check('К4.4 у C лишних заявок нет', not exists (select 1 from public.list_incoming_friend_requests())
    and public.friendship_status(d) = 'friends');
  perform pg_temp.act_as_postgres();
  select count(*) into n from public.friendships
  where least(requester_id, addressee_id) = least(c, d) and greatest(requester_id, addressee_id) = greatest(c, d);
  perform pg_temp.check('К4.4 одна строка на пару', n = 1, n::text);

  -- Себя нельзя.
  perform pg_temp.act_as(c);
  begin
    perform public.send_friend_request(c);
    perform pg_temp.check('себя в друзья нельзя', false, 'прошло');
  exception when others then perform pg_temp.check('себя в друзья нельзя', sqlstate = '22023', sqlstate);
  end;

  -- Отозвал после моего отказа — моё «Добавить» не делает друзьями без него.
  perform pg_temp.act_as(a);
  perform public.send_friend_request(b);
  perform pg_temp.act_as(b);
  perform public.decline_friend_request(a);
  perform pg_temp.act_as(a);
  perform public.cancel_friend_request(b);
  perform pg_temp.act_as(b);
  s := public.send_friend_request(a);
  perform pg_temp.check('после отзыва его заявки моё «Добавить» — новая заявка', s = 'outgoing', s);
  perform pg_temp.act_as(a);
  perform pg_temp.check('и она пришла ему', public.friendship_status(b) = 'incoming');

  -- Лимит частоты.
  perform pg_temp.act_as_postgres();
  insert into public.friend_request_log (requester_id) select a from generate_series(1, 30);
  perform pg_temp.act_as(a);
  begin
    perform public.send_friend_request(d);
    perform pg_temp.check('лимит заявок в час (OPN05)', false, 'прошло');
  exception when others then perform pg_temp.check('лимит заявок в час (OPN05)', sqlstate = 'OPN05', sqlstate);
  end;

  -- ===================================================== Брошенные аккаунты
  perform pg_temp.act_as_postgres();
  update public.privacy_settings set created_at = now() - interval '25 hours' where user_id in (e, a, f);
  n := public.delete_abandoned_accounts();
  perform pg_temp.check('брошенный без даты удалён', not exists (select 1 from auth.users where id = e)
    and not exists (select 1 from public.profiles where id = e), n::text);
  perform pg_temp.check('старый аккаунт с датой не тронут', exists (select 1 from auth.users where id = a));
  perform pg_temp.check('без даты, но с живым за сутки сеансом — не удалён',
    exists (select 1 from auth.users where id = f));
  update auth.sessions set created_at = now() - interval '2 days', updated_at = now() - interval '2 days',
    refreshed_at = null where user_id = f;
  n := public.delete_abandoned_accounts();
  perform pg_temp.check('сеанс затих на сутки — удалён', not exists (select 1 from auth.users where id = f), n::text);

  -- Удаление аккаунта уносит дружбы.
  delete from auth.users where id = c;
  perform pg_temp.check('дружбы удалённого уходят каскадом', not exists (
    select 1 from public.friendships where requester_id = c or addressee_id = c));
end;
$$;

select n, ok, name, detail from results order by n;

rollback;
