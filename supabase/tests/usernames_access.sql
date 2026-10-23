-- Имена: раздельные пространства человека, канала и группы; алфавит без
-- точки — в схеме; имя группы ставит только её участник.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/usernames_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000aa', 'ua@test.local', '{"full_name":"A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000ab', 'ub@test.local', '{"full_name":"B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000ac', 'uc@test.local', '{"full_name":"C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000ad', 'ud@test.local', '{"full_name":"D"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void language sql as $$
  insert into results (name, ok, detail) values (name, ok, detail);
$$;

-- Задержка публикации для зрителей (этап 6) у защитных настроек включена — здесь проверяется не она.
update public.privacy_settings set public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like '%@test.local');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000ab';
  c uuid := '00000000-0000-4000-8000-0000000000ac';
  d uuid := '00000000-0000-4000-8000-0000000000ad';
  grp uuid;
  grp2 uuid;
  dm uuid;
  posts uuid;
begin
  -- Человек `same_zz`, канал `same_zz`, группа `same_zz` — одновременно.
  perform pg_temp.act_as(a);
  update public.profiles set username = 'same_zz' where id = a;
  posts := (public.create_channel('Канал', 'same_zz') ->> 'chat_id')::uuid;
  perform pg_temp.check('К1.1 канал берёт имя человека', posts is not null);

  begin
    perform public.create_channel('Канал 2', 'SAME_zz');
    perform pg_temp.check('К1.3 второй канал с тем же именем в другом регистре — отказ', false);
  exception when others then
    perform pg_temp.check('К1.3 второй канал с тем же именем в другом регистре — отказ', sqlstate = 'OPN02', sqlerrm);
  end;

  begin
    perform public.create_channel('Канал 3', 'with.dot_zz');
    perform pg_temp.check('К1.4 канал с точкой — отказ', false);
  exception when others then
    perform pg_temp.check('К1.4 канал с точкой — отказ', sqlstate = '22023', sqlerrm);
  end;

  begin
    perform public.create_channel('Канал 4', '  ');
    perform pg_temp.check('К4.3 канал без имени — отказ', false);
  exception when others then
    perform pg_temp.check('К4.3 канал без имени — отказ', sqlstate = '22023', sqlerrm);
  end;

  -- Группа: A создатель, B и C зовутся; B принимает, C — нет.
  grp := (public.create_chat(array[b, c], 'Группа') ->> 'chat_id')::uuid;
  -- Друзья: личка без заявки (этап 3 приватности).
  perform set_config('role', 'postgres', true);
  insert into public.friendships (requester_id, addressee_id, status, accepted_at)
  values (a, d, 'accepted', now());
  perform pg_temp.act_as(a);
  dm := (public.create_chat(array[d]) ->> 'chat_id')::uuid;

  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(grp);

  perform pg_temp.check('свободно до установки', public.is_username_available('group', 'SAME_ZZ'));
  -- Имя группы ставит только владелец (20261020100000_group_management.sql).
  begin
    perform public.set_chat_username(grp, 'same_zz');
    perform pg_temp.check('участник-не-владелец не ставит имя группе', false);
  exception when others then
    perform pg_temp.check('участник-не-владелец не ставит имя группе', sqlstate = '42501', sqlerrm);
  end;
  perform pg_temp.act_as(a);
  perform public.set_chat_username(grp, 'same_zz');
  perform pg_temp.act_as(b);
  perform pg_temp.check('К1.5 владелец ставит имя группе',
    (select username from public.chats where id = grp) = 'same_zz');
  perform pg_temp.check('своё имя группы не занято для неё самой',
    public.is_username_available('group', 'same_zz', grp));
  perform pg_temp.check('для другой группы имя занято',
    not public.is_username_available('group', 'same_zz'));

  update public.profiles set username = 'Same_ZZ_b' where id = b;
  begin
    update public.profiles set username = 'SAME_ZZ' where id = b;
    perform pg_temp.check('второй человек с тем же именем в другом регистре — отказ', false);
  exception when others then
    perform pg_temp.check('второй человек с тем же именем в другом регистре — отказ', sqlstate = '23505', sqlerrm);
  end;

  begin
    update public.profiles set username = 'b.dot' where id = b;
    perform pg_temp.check('К1.4 прямой UPDATE профиля с точкой — отказ', false);
  exception when others then
    perform pg_temp.check('К1.4 прямой UPDATE профиля с точкой — отказ', sqlstate = '23514', sqlerrm);
  end;

  perform pg_temp.act_as(a);
  begin
    perform public.set_chat_username(grp, 'g.dot');
    perform pg_temp.check('К1.4 имя группы с точкой — отказ', false);
  exception when others then
    perform pg_temp.check('К1.4 имя группы с точкой — отказ', sqlstate = '22023', sqlerrm);
  end;
  perform pg_temp.act_as(b);

  begin
    update public.chats set username = 'direct_zz' where id = grp;
    perform pg_temp.check('прямой UPDATE chats.username — отказ', false);
  exception when others then
    perform pg_temp.check('прямой UPDATE chats.username — отказ', sqlstate = '42501', sqlerrm);
  end;

  -- Создатель группы, которому открыт UPDATE title, колонку имени тоже не пишет.
  perform pg_temp.act_as(a);
  begin
    update public.chats set username = 'direct_zz' where id = grp;
    perform pg_temp.check('создатель не пишет chats.username напрямую', false);
  exception when others then
    perform pg_temp.check('создатель не пишет chats.username напрямую', sqlstate = '42501', sqlerrm);
  end;

  -- Вторая группа с тем же именем.
  grp2 := (public.create_chat(array[b, d], 'Группа 2') ->> 'chat_id')::uuid;
  begin
    perform public.set_chat_username(grp2, 'SAME_zz');
    perform pg_temp.check('К5.5 две группы с одним именем — отказ', false);
  exception when others then
    perform pg_temp.check('К5.5 две группы с одним именем — отказ', sqlstate = 'OPN02', sqlerrm);
  end;

  begin
    perform public.set_chat_username(dm, 'dm_zz');
    perform pg_temp.check('К1.5 личному диалогу имя не ставится', false);
  exception when others then
    perform pg_temp.check('К1.5 личному диалогу имя не ставится', sqlstate = '22023', sqlerrm);
  end;

  begin
    perform public.set_chat_username(posts, 'posts_zz');
    perform pg_temp.check('чату постов имя не ставится', false);
  exception when others then
    perform pg_temp.check('чату постов имя не ставится', sqlstate = '22023', sqlerrm);
  end;

  -- C позван, но не принял; D — совсем посторонний.
  perform pg_temp.act_as(c);
  begin
    perform public.set_chat_username(grp, 'hack_zz');
    perform pg_temp.check('К1.5 приглашённый, но не принявший — отказ', false);
  exception when others then
    perform pg_temp.check('К1.5 приглашённый, но не принявший — отказ', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.act_as(d);
  begin
    perform public.set_chat_username(grp, 'hack_zz');
    perform pg_temp.check('К1.5 посторонний не ставит имя группе', false);
  exception when others then
    perform pg_temp.check('К1.5 посторонний не ставит имя группе', sqlstate = '42501', sqlerrm);
  end;
  perform pg_temp.check('посторонний видит имя группы',
    (select username from public.chats where id = grp) = 'same_zz');

  -- Человек убирает своё имя — оно сразу свободно для другого.
  perform pg_temp.act_as(a);
  update public.profiles set username = null where id = a;
  perform pg_temp.act_as(d);
  perform pg_temp.check('К4.2 освобождённое имя свободно', public.is_username_available('profile', 'same_zz'));
  update public.profiles set username = 'same_zz' where id = d;
  perform pg_temp.check('К4.2 другой человек берёт освобождённое имя',
    (select username from public.profile_cards(array[d])) = 'same_zz');
  perform pg_temp.check('своё имя профиля не занято для себя',
    public.is_username_available('profile', 'SAME_ZZ'));
  perform pg_temp.check('занятое другим человеком имя — занято',
    not public.is_username_available('profile', 'same_zz_b'));
  perform pg_temp.check('К3.3 имя канала свободно для профиля',
    public.is_username_available('profile', 'same_zz') and not public.is_username_available('channel', 'same_zz'));

  -- Участник убирает имя группы.
  perform pg_temp.act_as(a);
  perform public.set_chat_username(grp, '  ');
  perform pg_temp.check('К5.2 владелец убирает имя группы',
    (select username from public.chats where id = grp) is null);

  -- В обход функций, даже от владельца схемы: инварианты в самой таблице.
  perform set_config('role', 'postgres', true);
  begin
    update public.chats set username = 'dm_zz' where id = dm;
    perform pg_temp.check('имя у личного диалога — отказ схемы', false);
  exception when others then
    perform pg_temp.check('имя у личного диалога — отказ схемы', sqlstate = '23514', sqlerrm);
  end;
  begin
    update public.channels set username = 'c.h' where posts_chat_id = posts;
    perform pg_temp.check('канал с точкой — отказ схемы', false);
  exception when others then
    perform pg_temp.check('канал с точкой — отказ схемы', sqlstate = '23514', sqlerrm);
  end;
  begin
    update public.chats set username = 'g.h' where id = grp;
    perform pg_temp.check('группа с точкой — отказ схемы', false);
  exception when others then
    perform pg_temp.check('группа с точкой — отказ схемы', sqlstate = '23514', sqlerrm);
  end;
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
