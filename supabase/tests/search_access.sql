-- Поиск: нормализация, ранг сущностей, блоки «Чаты» / «Глобальный поиск»,
-- сообщения только из моих чатов и подписок.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/search_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000ba', 'sa@test.local', '{"full_name":"A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000bb', 'sb@test.local', '{"full_name":"B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000bc', 'sc@test.local', '{"full_name":"C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000bd', 'sd@test.local', '{"full_name":"D"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void language sql as $$
  insert into results (name, ok, detail) values (name, ok, detail);
$$;

/** Строки блока: «вид:название» по порядку — для проверок и для detail. */
create function pg_temp.block(q text, which text) returns text[] language sql as $$
  select coalesce(array_agg(entity_kind || ':' || title order by n), '{}')
  from (
    select row_number() over () as n, * from public.search_entities(q, 50, 50)
  ) r
  where section = which;
$$;

create function pg_temp.messages(q text) returns text[] language sql as $$
  select coalesce(array_agg(text order by seq desc), '{}')
  from public.search_messages(q, null, 50);
$$;

-- Тестовые аккаунты рождаются с защитными настройками приватности
-- (20261029100000_privacy_settings.sql). Здесь проверяется не она: время,
-- «в сети», поиск и имя открыты всем — их скрытие проверяет
-- privacy_activity_search_access.sql.
update public.privacy_settings set
  message_activity_metadata_visibility = 'everyone',
  activity_status_visibility = 'everyone',
  account_search_visibility = 'everyone',
  profile_identity_masking = 'everyone',
  dialogue_participant_name_masking = 'everyone',
  avatar_visibility = 'everyone'
where user_id in (select id from auth.users where email like '%@test.local');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000ba';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  c uuid := '00000000-0000-4000-8000-0000000000bc';
  d uuid := '00000000-0000-4000-8000-0000000000bd';
  dm_ad uuid;
  dm_bc uuid;
  grp uuid;
  secret_grp uuid;
  tg_channel uuid;
  tg_posts uuid;
  page1 record;
  page_ids uuid[];
  page2_ids uuid[];
  got text[];
begin
  -- ---------------------------------------------------------------- данные
  perform pg_temp.as_owner();
  update public.profiles set display_name = 'Искатель Зэ', username = 'zqseeker' where id = a;
  update public.profiles set display_name = 'Максимилиан', username = 'zqmax' where id = b;
  update public.profiles set display_name = 'Другой Человек', username = 'zqmaximus' where id = c;
  update public.profiles set display_name = 'Безымянный Зэчеловек', username = null where id = d;

  -- Мой диалог с человеком без @имени.
  insert into public.chats (kind, created_by) values ('direct', a) returning id into dm_ad;
  insert into public.chat_members (chat_id, user_id) values (dm_ad, a), (dm_ad, d);
  insert into public.messages (chat_id, author_id, kind, text, created_at) values
    (dm_ad, a, 'text', 'Привет всем зэтест', now() - interval '50 minutes'),
    (dm_ad, d, 'text', 'Одно сообщение зэтест', now() - interval '40 minutes'),
    (dm_ad, d, 'text', 'Длинное слово телеграмзэ внутри', now() - interval '35 minutes'),
    (dm_ad, a, 'system', 'системноезэ событие', now() - interval '30 minutes'),
    (dm_ad, a, 'text', 'пагинациязэ первое', now() - interval '20 minutes'),
    (dm_ad, a, 'text', 'пагинациязэ второе', now() - interval '10 minutes'),
    (dm_ad, a, 'text', 'пагинациязэ третье', now() - interval '5 minutes');
  insert into public.messages (chat_id, author_id, kind, text, deleted_at) values
    (dm_ad, a, 'text', 'удалённоезэ сообщение', now());

  -- Чужой диалог без меня.
  insert into public.chats (kind, created_by) values ('direct', b) returning id into dm_bc;
  insert into public.chat_members (chat_id, user_id) values (dm_bc, b), (dm_bc, c);
  insert into public.messages (chat_id, author_id, kind, text) values
    (dm_bc, b, 'text', 'чужоеслово зэтест');

  -- Чужие группы: с @именем и без.
  insert into public.chats (kind, created_by, title) values ('group', c, 'Группа ёжиков')
    returning id into grp;
  insert into public.chat_members (chat_id, user_id) values (grp, c), (grp, b);
  update public.chats set username = 'zqgroup' where id = grp;
  insert into public.chats (kind, created_by, title) values ('group', c, 'Секретная тайнозэ')
    returning id into secret_grp;
  insert into public.chat_members (chat_id, user_id) values (secret_grp, c);

  -- Каналы человека C.
  perform pg_temp.act_as(c);
  perform public.create_channel('Ёлка Зэ', 'zqelka');
  tg_posts := (public.create_channel('Телеграм канал Зэ', 'zqtg') ->> 'chat_id')::uuid;
  tg_channel := (select id from public.channels where posts_chat_id = tg_posts);
  perform public.create_channel('Квазар', 'zqkv1');
  perform public.create_channel('Квазары тут', 'zqkv2');
  perform public.create_channel('Мегаквазар', 'zqkv3');
  perform public.create_channel('Квазор', 'zqkv4');
  perform public.create_channel('Zqmax news', 'zqnews');

  perform pg_temp.as_owner();
  insert into public.messages (chat_id, author_id, kind, text) values
    (tg_posts, c, 'text', 'пост подписчикузэ');

  -- --------------------------------------------------------- нормализация
  perform pg_temp.act_as(a);

  got := pg_temp.block('елка зэ', 'global');
  perform pg_temp.check('К1.1 «елка» находит канал «Ёлка»', got @> array['channel:Ёлка Зэ'], got::text);
  got := pg_temp.block('ЁЛКА', 'global');
  perform pg_temp.check('К1.1 «ЁЛКА» находит канал «Ёлка»', got @> array['channel:Ёлка Зэ'], got::text);

  got := pg_temp.messages('ПРИВ');
  perform pg_temp.check('К1.2 «ПРИВ» находит «Привет всем»', got @> array['Привет всем зэтест'], got::text);

  got := pg_temp.messages('сообщения');
  perform pg_temp.check('К1.3 «сообщения» находит «сообщение»', got @> array['Одно сообщение зэтест'], got::text);

  got := pg_temp.messages('грамзэ');
  perform pg_temp.check('К1.4 середина слова', got @> array['Длинное слово телеграмзэ внутри'], got::text);

  got := pg_temp.block('Мксимилиан', 'global');
  perform pg_temp.check('К1.5 опечатка в имени человека', got @> array['person:Максимилиан'], got::text);

  got := array(select x from unnest(pg_temp.block('квазар', 'global')) x
    where x in ('channel:Квазар', 'channel:Квазары тут', 'channel:Мегаквазар', 'channel:Квазор'));
  perform pg_temp.check('К1.6 точное → начало слова → середина → опечатка',
    got = array['channel:Квазар', 'channel:Квазары тут', 'channel:Мегаквазар', 'channel:Квазор'],
    got::text);

  got := pg_temp.messages('удалённоезэ') || pg_temp.messages('системноезэ');
  perform pg_temp.check('К1.7 удалённые и системные не находятся', got = '{}', got::text);

  -- -------------------------------------------------------------- блоки
  got := pg_temp.block('Безымянный Зэчеловек', 'mine');
  perform pg_temp.check('К3.1 мой диалог — в «Чатах» по имени собеседника',
    got = array['direct:Безымянный Зэчеловек'], got::text);
  got := pg_temp.block('Безымянный Зэчеловек', 'global');
  perform pg_temp.check('К3.5 человек без @имени глобально не находится', got = '{}', got::text);

  got := pg_temp.block('zqtg', 'global');
  perform pg_temp.check('К3.3 чужой канал по @имени — в глобальном', got = array['channel:Телеграм канал Зэ'], got::text);
  got := pg_temp.block('Телеграм канал', 'global');
  perform pg_temp.check('К3.3 чужой канал по названию — в глобальном', got @> array['channel:Телеграм канал Зэ'], got::text);

  got := pg_temp.messages('подписчикузэ');
  perform pg_temp.check('К3.9 посты неподписанного канала не находятся', got = '{}', got::text);

  perform public.subscribe_to_channel(tg_channel, false);

  got := pg_temp.block('zqtg', 'global');
  perform pg_temp.check('К3.3 после подписки канала нет в глобальном', got = '{}', got::text);
  got := pg_temp.block('zqtg', 'mine');
  perform pg_temp.check('К3.3 после подписки (не в «Чатах») — в «Чатах»', got = array['channel:Телеграм канал Зэ'], got::text);
  got := pg_temp.messages('подписчикузэ');
  perform pg_temp.check('К3.10 посты канала-подписки без «в Чатах» находятся', got = array['пост подписчикузэ'], got::text);

  perform pg_temp.act_as(c);
  got := pg_temp.block('zqtg', 'mine') || pg_temp.block('zqtg', 'global');
  perform pg_temp.check('К3.3 мой канал — только в «Чатах»', got = array['channel:Телеграм канал Зэ'], got::text);
  perform pg_temp.act_as(a);

  got := pg_temp.block('ежиков', 'global');
  perform pg_temp.check('К3.4 чужая группа по названию', got = array['group:Группа ёжиков'], got::text);
  got := pg_temp.block('@zqgroup.di', 'global');
  perform pg_temp.check('К3.4 чужая группа по @имя.di', got = array['group:Группа ёжиков'], got::text);
  got := pg_temp.block('тайнозэ', 'global') || pg_temp.block('тайнозэ', 'mine');
  perform pg_temp.check('К3.4 группа без @имени глобально не находится', got = '{}', got::text);

  got := pg_temp.block('@zqmax', 'global');
  perform pg_temp.check('К3.5 человек по @username', got[1] = 'person:Максимилиан', got::text);
  perform pg_temp.check('К3.7 точный @zqmax выше @zqmaximus',
    array_position(got, 'person:Максимилиан') < array_position(got, 'person:Другой Человек'), got::text);
  perform pg_temp.check('К3.6 @zqmax: человек выше канала «Zqmax news»',
    array_position(got, 'person:Максимилиан') < array_position(got, 'channel:Zqmax news'), got::text);

  got := pg_temp.block('zqmax.ch', 'global');
  perform pg_temp.check('К3.8 .ch — только каналы', got <> '{}' and not exists (
    select 1 from unnest(got) x where x not like 'channel:%'), got::text);
  got := pg_temp.block('zqgroup.di', 'global');
  perform pg_temp.check('К3.8 .di — только группы', got = array['group:Группа ёжиков'], got::text);
  got := pg_temp.block('zqmax', 'global');
  perform pg_temp.check('К3.8 без суффикса — все виды',
    got @> array['person:Максимилиан', 'channel:Zqmax news'], got::text);
  got := pg_temp.block('zqseeker', 'global');
  perform pg_temp.check('сам человек в глобальном не показывается', got = '{}', got::text);

  -- -------------------------------------------- доступ к сообщениям чужого чата
  got := pg_temp.messages('чужоеслово');
  perform pg_temp.check('К3.9 сообщения чужого чата без участия и подписки не находятся', got = '{}', got::text);
  perform public.subscribe_to_chat(dm_bc);
  got := pg_temp.messages('чужоеслово');
  perform pg_temp.check('К3.9 подписался на чат — находятся', got = array['чужоеслово зэтест'], got::text);
  got := pg_temp.block('Максимилиан', 'mine');
  perform pg_temp.check('чужой диалог по подписке — в «Чатах» названием глазами постороннего',
    got = array['direct:Максимилиан и Другой Человек'], got::text);

  -- ------------------------------------------------------------ пагинация
  page_ids := array(select message_id from public.search_messages('пагинациязэ', null, 2));
  select * into page1 from public.search_messages('пагинациязэ', null, 2) offset 1 limit 1;
  page2_ids := array(select message_id from public.search_messages('пагинациязэ', page1.seq, 2));
  got := array(select m.text from public.search_messages('пагинациязэ', null, 2) m)
      || array(select m.text from public.search_messages('пагинациязэ', page1.seq, 2) m);
  perform pg_temp.check('К3.11 от новых к старым, страницы без дублей и пропусков',
    got = array['пагинациязэ третье', 'пагинациязэ второе', 'пагинациязэ первое']
      and not (page_ids && page2_ids), got::text);

  -- ---------------------------------------------------------- опечатки
  got := pg_temp.messages('тлеграмзэ');
  perform pg_temp.check('опечатка в сообщении — когда точного нет', got @> array['Длинное слово телеграмзэ внутри'], got::text);
  perform pg_temp.check('опечатка помечена fuzzy',
    (select bool_and(fuzzy) from public.search_messages('тлеграмзэ', null, 50)), null);
  perform pg_temp.check('точное совпадение — без опечаток',
    not (select bool_or(fuzzy) from public.search_messages('зэтест', null, 50)), null);

  -- ---------------------------------------------------------- без входа
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'anon', true);
  begin
    perform public.search_messages('зэтест');
    perform pg_temp.check('аноним не ищет', false);
  exception when others then
    perform pg_temp.check('аноним не ищет', sqlstate = '42501', sqlerrm);
  end;
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
