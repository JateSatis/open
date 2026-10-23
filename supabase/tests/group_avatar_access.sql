-- Аватарка группы: ставит и убирает только участник живой группы, у диалога
-- и чата постов её нет, адрес — только файл аватарки группы в своём префиксе
-- нашего бакета; `create_chat` создаёт группу сразу с фото, диалог — без.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/group_avatar_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

-- Этап 5: вложения, попсы и фото принимаются только очищенными файлами
-- (`media_objects`, проверяет privacy_media_access.sql). Этот тест не про
-- очистку: файлы его фикстур отмечаются очищенными до проверки. Функция и
-- триггеры живут только в этой транзакции.
create function public.test_mark_sanitized() returns trigger
language plpgsql security definer set search_path = public as $fixture$
declare
  owner uuid;
begin
  if tg_table_name = 'objects' then
    if new.bucket_id = 'media' and (storage.foldername(new.name))[2] in ('group-avatar', 'channel-avatar') then
      insert into public.media_objects (bucket, path, owner_id, kind, mime_type, size_bytes)
      select 'media', new.name, p.id,
        case (storage.foldername(new.name))[2] when 'group-avatar' then 'group_avatar' else 'channel_avatar' end,
        'image/jpeg', 0
      from public.profiles p where p.id = public.uuid_or_null((storage.foldername(new.name))[1])
      on conflict do nothing;
    end if;
    return new;
  end if;

  if tg_table_name = 'profiles' then
    if new.avatar_url is not null then
      insert into public.media_objects (bucket, path, owner_id, kind, mime_type, size_bytes)
      values ('avatars', new.avatar_url, new.id, 'avatar', 'image/jpeg', 0)
      on conflict do nothing;
    end if;
    return new;
  end if;

  if tg_table_name = 'pops' then
    insert into public.media_objects (bucket, path, owner_id, kind, mime_type, size_bytes)
    select 'media', v.p, new.author_id, v.k, 'video/mp4', 0
    from (values (public.public_media_path(new.url), 'pop_video'),
                 (public.public_media_path(new.poster_url), 'pop_poster')) v(p, k)
    where v.p is not null and new.author_id is not null
    on conflict do nothing;
    return new;
  end if;

  if tg_table_name = 'attachments' then
    if new.pop_id is not null then
      return new;
    end if;

    select m.author_id into owner from public.messages m where m.id = new.message_id;
  else
    select c.author_id into owner from public.comments c where c.id = new.comment_id;
  end if;

  insert into public.media_objects (bucket, path, owner_id, kind, mime_type, size_bytes)
  select 'chat-media', v.p, owner, v.k, coalesce(new.mime_type, ''), 0
  from (values
    (new.url, case
      when new.mime_type like 'image/%' then 'photo'
      when new.mime_type like 'audio/%' then 'voice'
      else 'video' end),
    (new.poster_url, 'poster')
  ) v(p, k)
  where v.p is not null and owner is not null
  on conflict do nothing;

  return new;
end;
$fixture$;

create trigger attachments_aa_test_sanitized before insert or update of url, poster_url
  on public.attachments for each row execute function public.test_mark_sanitized();
create trigger comment_attachments_aa_test_sanitized before insert or update of url, poster_url
  on public.comment_attachments for each row execute function public.test_mark_sanitized();
create trigger pops_aa_test_sanitized before insert or update of url, poster_url
  on public.pops for each row execute function public.test_mark_sanitized();
create trigger profiles_aa_test_sanitized before update of avatar_url
  on public.profiles for each row execute function public.test_mark_sanitized();
create trigger aa_test_sanitized before insert
  on storage.objects for each row execute function public.test_mark_sanitized();

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000ba', 'ga@test.local', '{"full_name":"A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000bb', 'gb@test.local', '{"full_name":"B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000bc', 'gc@test.local', '{"full_name":"C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000bd', 'gd@test.local', '{"full_name":"D"}', 'authenticated', 'authenticated');

-- Файлы в бакете — как после загрузки из приложения.
insert into storage.objects (bucket_id, name) values
  ('media', '00000000-0000-4000-8000-0000000000ba/group-avatar/a1.jpg'),
  ('media', '00000000-0000-4000-8000-0000000000ba/group-avatar/a2.jpg'),
  ('media', '00000000-0000-4000-8000-0000000000bb/group-avatar/b1.jpg'),
  ('media', '00000000-0000-4000-8000-0000000000bd/group-avatar/d1.jpg'),
  ('media', '00000000-0000-4000-8000-0000000000ba/avatar/p1.jpg');

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

create function pg_temp.url(path text) returns text language sql as $$
  select 'https://proj.supabase.co/storage/v1/object/public/media/' || path;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void language sql as $$
  insert into results (name, ok, detail) values (name, ok, detail);
$$;

create function pg_temp.avatar(chat uuid) returns text language sql as $$
  select avatar_url from public.chats where id = chat;
$$;

-- Задержка публикации для зрителей (этап 6) у защитных настроек включена — здесь проверяется не она.
update public.privacy_settings set public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like '%@test.local');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000ba';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  c uuid := '00000000-0000-4000-8000-0000000000bc';
  d uuid := '00000000-0000-4000-8000-0000000000bd';
  a1 text := pg_temp.url('00000000-0000-4000-8000-0000000000ba/group-avatar/a1.jpg');
  a2 text := pg_temp.url('00000000-0000-4000-8000-0000000000ba/group-avatar/a2.jpg');
  b1 text := pg_temp.url('00000000-0000-4000-8000-0000000000bb/group-avatar/b1.jpg');
  d1 text := pg_temp.url('00000000-0000-4000-8000-0000000000bd/group-avatar/d1.jpg');
  grp uuid;
  grp2 uuid;
  dm uuid;
  dm2 uuid;
  posts uuid;
  result jsonb;
begin
  perform pg_temp.act_as(a);

  -- create_chat: группа сразу с фото, диалог — без.
  grp := (public.create_chat(array[b, c], 'Группа', a1) ->> 'chat_id')::uuid;
  perform pg_temp.check('create_chat с фото создаёт группу с ним', pg_temp.avatar(grp) = a1);

  dm := (public.create_chat(array[d], null, a2) ->> 'chat_id')::uuid;
  perform pg_temp.check('create_chat диалога фото игнорирует',
    (select kind from public.chats where id = dm) = 'direct' and pg_temp.avatar(dm) is null);

  dm2 := (public.create_chat(array[c]) ->> 'chat_id')::uuid;
  perform pg_temp.check('create_chat без фото — как раньше', dm2 is not null and pg_temp.avatar(dm2) is null);

  begin
    perform public.create_chat(array[c, d], 'Чужое фото', b1);
    perform pg_temp.check('create_chat с файлом из чужого префикса — отказ', false);
  exception when others then
    perform pg_temp.check('create_chat с файлом из чужого префикса — отказ', sqlstate = '22023', sqlerrm);
  end;

  begin
    perform public.create_chat(array[b, c], 'Дубль', a2);
    perform pg_temp.check('дубль набора с фото — OPN01', false);
  exception when others then
    perform pg_temp.check('дубль набора с фото — OPN01', sqlstate = 'OPN01', sqlerrm);
  end;

  posts := (public.create_channel('Канал', 'ga_posts_zz') ->> 'chat_id')::uuid;

  -- К1.1: участник ставит и убирает.
  perform pg_temp.check('смена отдаёт прежний адрес — его файл и удаляет клиент',
    public.set_chat_avatar(grp, a2) = a1);
  perform pg_temp.check('К1.1 участник (создатель) меняет фото', pg_temp.avatar(grp) = a2);

  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(grp);
  -- Фото меняет только владелец (20261020100000_group_management.sql).
  begin
    perform public.set_chat_avatar(grp, b1);
    perform pg_temp.check('участник-не-владелец — отказ', false);
  exception when others then
    perform pg_temp.check('участник-не-владелец — отказ', sqlstate = '42501', sqlerrm);
  end;

  -- Дальше B — владелец: проверки адресов идут от его префикса.
  perform set_config('role', 'postgres', true);
  update public.chats set owner_id = b where id = grp;
  perform pg_temp.act_as(b);
  perform public.set_chat_avatar(grp, b1);
  perform pg_temp.check('К1.1 / К2.1 владелец ставит своё фото', pg_temp.avatar(grp) = b1);

  begin
    perform public.set_chat_avatar(grp, a1);
    perform pg_temp.check('файл из чужого префикса — отказ', false);
  exception when others then
    perform pg_temp.check('файл из чужого префикса — отказ', sqlstate = '22023', sqlerrm);
  end;

  begin
    perform public.set_chat_avatar(grp, 'https://evil.example/storage/v1/object/public/media/'
      || b::text || '/group-avatar/b1.jpg');
    perform pg_temp.check('сторонний адрес — отказ', false);
  exception when others then
    perform pg_temp.check('сторонний адрес — отказ', sqlstate = '22023', sqlerrm);
  end;

  begin
    perform public.set_chat_avatar(grp, pg_temp.url(b::text || '/group-avatar/missing.jpg'));
    perform pg_temp.check('несуществующий файл — отказ', false);
  exception when others then
    -- Этап 5: файла нет — его и не очищали, отказ проверки очистки.
    perform pg_temp.check('несуществующий файл — отказ', sqlstate = 'OPN14', sqlerrm);
  end;

  begin
    perform public.set_chat_avatar(grp, pg_temp.url(a::text || '/avatar/p1.jpg'));
    perform pg_temp.check('файл не из папки group-avatar — отказ', false);
  exception when others then
    perform pg_temp.check('файл не из папки group-avatar — отказ', sqlstate = '22023', sqlerrm);
  end;
  perform pg_temp.check('после отказов фото прежнее', pg_temp.avatar(grp) = b1);

  -- К1.3: прямой UPDATE — отказ, и у участника, и у создателя (у него открыт title).
  begin
    update public.chats set avatar_url = b1 where id = grp;
    perform pg_temp.check('К1.3 прямой UPDATE avatar_url участником — отказ', false);
  exception when others then
    perform pg_temp.check('К1.3 прямой UPDATE avatar_url участником — отказ', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.act_as(a);
  begin
    update public.chats set avatar_url = a1 where id = grp;
    perform pg_temp.check('К1.3 прямой UPDATE avatar_url создателем — отказ', false);
  exception when others then
    perform pg_temp.check('К1.3 прямой UPDATE avatar_url создателем — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.clean_group_avatar_url(a1);
    perform pg_temp.check('внутренняя проверка адреса клиенту закрыта', false);
  exception when others then
    perform pg_temp.check('внутренняя проверка адреса клиенту закрыта', sqlstate = '42501', sqlerrm);
  end;

  -- К1.4: диалог и чат постов — отказ.
  begin
    perform public.set_chat_avatar(dm, a1);
    perform pg_temp.check('К1.4 у личного диалога — отказ', false);
  exception when others then
    perform pg_temp.check('К1.4 у личного диалога — отказ', sqlstate = '22023', sqlerrm);
  end;

  begin
    perform public.set_chat_avatar(posts, a1);
    perform pg_temp.check('К1.4 у чата постов — отказ', false);
  exception when others then
    perform pg_temp.check('К1.4 у чата постов — отказ', sqlstate = '22023', sqlerrm);
  end;

  -- К1.2: позванный, но не принявший, и посторонний — отказ.
  perform pg_temp.act_as(c);
  begin
    perform public.set_chat_avatar(grp, null);
    perform pg_temp.check('К1.2 позванный, но не принявший — отказ', false);
  exception when others then
    perform pg_temp.check('К1.2 позванный, но не принявший — отказ', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.act_as(d);
  begin
    perform public.set_chat_avatar(grp, d1);
    perform pg_temp.check('К1.2 посторонний — отказ', false);
  exception when others then
    perform pg_temp.check('К1.2 посторонний — отказ', sqlstate = '42501', sqlerrm);
  end;
  perform pg_temp.check('К1.2 у постороннего фото прежнее и видно', pg_temp.avatar(grp) = b1);

  -- Поиск: своя группа и чужая (с @именем) — с фото.
  perform pg_temp.act_as(b);
  perform public.set_chat_username(grp, 'ga_group_zz');
  perform pg_temp.check('К5.3 поиск своей группы отдаёт её фото',
    (select avatar_url from public.search_entities('ga_group_zz') where chat_id = grp) = b1);

  perform pg_temp.act_as(d);
  perform pg_temp.check('К5.3 поиск чужой группы отдаёт её фото',
    (select avatar_url from public.search_entities('ga_group_zz')
      where chat_id = grp and section = 'global') = b1);

  perform pg_temp.act_as(b);
  insert into public.messages (chat_id, author_id, kind, text) values (grp, b, 'text', 'гаудиофото проверка');
  perform pg_temp.check('К5.3 сообщение из группы — с фото группы',
    (select chat_avatar_url from public.search_messages('гаудиофото') where chat_id = grp limit 1) = b1);

  -- Один файл — одна группа: иначе удаление прежнего файла сломало бы другую.
  begin
    perform public.create_chat(array[a, d], 'Тот же файл', b1);
    perform pg_temp.check('файл, уже стоящий у другой группы, — отказ', false);
  exception when others then
    perform pg_temp.check('файл, уже стоящий у другой группы, — отказ', sqlstate = '23505', sqlerrm);
  end;

  -- К1.1: участник убирает.
  perform public.set_chat_avatar(grp, '  ');
  perform pg_temp.check('К1.1 участник убирает фото', pg_temp.avatar(grp) is null);

  -- Без iss в токене адрес не проверить — отказ, а не пропуск.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin
    perform public.set_chat_avatar(grp, b1);
    perform pg_temp.check('без iss — отказ', false);
  exception when others then
    perform pg_temp.check('без iss — отказ', sqlstate = '42501', sqlerrm);
  end;

  -- Инвариант в самой таблице, даже от владельца схемы.
  perform set_config('role', 'postgres', true);
  begin
    update public.chats set avatar_url = a1 where id = dm;
    perform pg_temp.check('фото у личного диалога — отказ схемы', false);
  exception when others then
    perform pg_temp.check('фото у личного диалога — отказ схемы', sqlstate = '23514', sqlerrm);
  end;
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
