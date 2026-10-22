-- Страница канала и правка канала: менять название, описание, `@имя` и фото
-- может только владелец, подписчиков (и поиск по ним) видит только он; сводка
-- страницы, канал по `@имени` без учёта регистра.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/channel_info_page_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000003a1', 'ca@test.local', '{"full_name":"Аня"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000003b1', 'cb@test.local', '{"full_name":"Борис"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000003c1', 'cc@test.local', '{"full_name":"Виктор"}', 'authenticated', 'authenticated');

-- Тестовые аккаунты рождаются с подростковыми настройками: имя видно только
-- друзьям. Здесь проверяется не подмена — её проверяет privacy_identity_access.sql.
update public.privacy_settings set profile_identity_masking = 'everyone'
where user_id in (select id from auth.users where email like '%@test.local');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid,
    'role', 'authenticated',
    'iss', 'https://proj.supabase.co/auth/v1'
  )::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void language sql as $$
  insert into results (name, ok, detail) values (name, coalesce(ok, false), detail);
$$;

create function pg_temp.denied(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate;
end;
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000003a1';
  b uuid := '00000000-0000-4000-8000-0000000003b1';
  c uuid := '00000000-0000-4000-8000-0000000003c1';
  ch uuid;
  other_ch uuid;
  code text;
  s text;
  n int;
begin
  -- --------------------------------------------------------------- засев
  perform pg_temp.act_as(a);
  ch := (public.create_channel('Канал', 'info_test_ch', null, null) ->> 'channel_id')::uuid;
  other_ch := (public.create_channel('Другой', 'info_test_other', null, null) ->> 'channel_id')::uuid;

  perform pg_temp.act_as(b);
  perform public.subscribe_to_channel(ch, true);

  -- --------------------------------------------------------------- право менять канал
  for s in select unnest(array[
    format('select public.set_channel_title(%L, %L)', ch, 'Новое'),
    format('select public.set_channel_description(%L, %L)', ch, 'Описание'),
    format('select public.set_channel_username(%L, %L)', ch, 'info_test_new'),
    format('select public.set_channel_avatar(%L, %L)', ch, '')
  ]) loop
    perform pg_temp.act_as(b);
    code := pg_temp.denied(s);
    perform pg_temp.check('подписчик: отказ — ' || split_part(s, '(', 1), code = '42501', code);

    perform pg_temp.act_as(c);
    code := pg_temp.denied(s);
    perform pg_temp.check('посторонний: отказ — ' || split_part(s, '(', 1), code = '42501', code);

    perform pg_temp.act_as(a);
    code := pg_temp.denied(s);
    perform pg_temp.check('владелец: успех — ' || split_part(s, '(', 1), code is null, code);
  end loop;

  perform pg_temp.as_admin();
  perform pg_temp.check('название, описание и имя сохранены',
    (select title = 'Новое' and description = 'Описание' and username = 'info_test_new'
     from public.channels where id = ch));

  perform pg_temp.act_as(a);
  code := pg_temp.denied(format('select public.set_channel_title(%L, %L)', ch, '   '));
  perform pg_temp.check('пустое название: отказ', code = '22023', code);

  code := pg_temp.denied(format('select public.set_channel_username(%L, %L)', ch, ''));
  perform pg_temp.check('пустое имя: отказ', code = '22023', code);

  code := pg_temp.denied(format('select public.set_channel_username(%L, %L)', ch, 'не имя'));
  perform pg_temp.check('имя не из алфавита: отказ', code = '22023', code);

  code := pg_temp.denied(format('select public.set_channel_username(%L, %L)', ch, 'INFO_TEST_OTHER'));
  perform pg_temp.check('имя другого канала (другой регистр): OPN02', code = 'OPN02', code);

  code := pg_temp.denied(format('select public.set_channel_avatar(%L, %L)', ch, 'https://evil.example/a.jpg'));
  perform pg_temp.check('чужой адрес фото: отказ', code = '22023', code);

  code := pg_temp.denied(format(
    'select public.set_channel_avatar(%L, %L)', ch,
    'https://proj.supabase.co/storage/v1/object/public/media/' || a || '/channel-avatar/nofile.jpg'));
  perform pg_temp.check('несуществующий файл фото: отказ', code = '22023', code);

  code := pg_temp.denied(format(
    'select public.create_channel(%L, %L, null, %L)', 'X', 'info_test_x', 'https://evil.example/a.jpg'));
  perform pg_temp.check('создание с чужим адресом фото: отказ', code = '22023', code);

  perform public.set_channel_description(ch, '  ');
  perform pg_temp.as_admin();
  perform pg_temp.check('пустое описание — null',
    (select description from public.channels where id = ch) is null);

  perform pg_temp.act_as(a);
  code := pg_temp.denied(format('update public.channels set title = %L where id = %L', 'Мимо', ch));
  perform pg_temp.as_admin();
  perform pg_temp.check('прямой UPDATE канала: ничего не меняет или отказ',
    code is not null or (select title from public.channels where id = ch) = 'Новое', code);

  -- --------------------------------------------------------------- подписчики
  for s in select unnest(array[
    format('select * from public.list_channel_subscribers(%L)', ch),
    format('select * from public.list_channel_subscribers(%L, null, null, 30, %L)', ch, 'Бор')
  ]) loop
    perform pg_temp.act_as(b);
    code := pg_temp.denied(s);
    perform pg_temp.check('подписчик смотрит подписчиков: отказ', code = '42501', code);

    perform pg_temp.act_as(c);
    code := pg_temp.denied(s);
    perform pg_temp.check('посторонний смотрит подписчиков: отказ', code = '42501', code);
  end loop;

  perform pg_temp.act_as(a);
  perform pg_temp.check('владелец видит подписчика-читателя',
    (select in_chats from public.list_channel_subscribers(ch) where subscriber_id = b));
  perform pg_temp.check('поиск по имени находит',
    (select count(*) from public.list_channel_subscribers(ch, null, null, 30, 'бор')) = 1);
  perform pg_temp.check('поиск по имени не находит чужое',
    (select count(*) from public.list_channel_subscribers(ch, null, null, 30, 'zzz')) = 0);

  -- --------------------------------------------------------------- сводка
  perform pg_temp.act_as(c);
  perform pg_temp.check('сводка: 1 подписчик, 1 читатель, 0 попсов',
    (select subscribers = 1 and readers = 1 and pops = 0 and photos = 0
     from public.channel_info_summary(ch)));

  -- --------------------------------------------------------------- по имени
  perform pg_temp.check('канал по новому имени, другой регистр',
    public.find_channel_by_username('INFO_Test_New') = ch);
  perform pg_temp.check('канал по имени с @',
    public.find_channel_by_username('@info_test_new') = ch);
  perform pg_temp.check('старое имя больше не ведёт на канал',
    public.find_channel_by_username('info_test_ch') is null);

  -- --------------------------------------------------------------- фото: один файл — один канал
  perform pg_temp.as_admin();
  insert into storage.objects (bucket_id, name, owner)
  values ('media', a || '/channel-avatar/info_test.jpg', a);
  perform pg_temp.act_as(a);
  s := 'https://proj.supabase.co/storage/v1/object/public/media/' || a || '/channel-avatar/info_test.jpg';
  code := pg_temp.denied(format('select public.set_channel_avatar(%L, %L)', ch, s));
  perform pg_temp.check('владелец ставит своё фото', code is null, code);
  code := pg_temp.denied(format('select public.set_channel_avatar(%L, %L)', other_ch, s));
  perform pg_temp.check('то же фото у второго канала: понятный отказ', code = '22023', code);
  code := pg_temp.denied(format('select public.create_channel(%L, %L, null, %L)', 'Третий', 'info_test_third', s));
  perform pg_temp.check('создание с чужим фото — не «имя занято»', code = '22023', code);

  perform pg_temp.act_as(b);
  perform public.unsubscribe_from_channel(ch);
  perform pg_temp.act_as(c);
  select subscribers into n from public.channel_info_summary(ch);
  perform pg_temp.check('после отписки подписчиков 0', n = 0, n::text);
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
