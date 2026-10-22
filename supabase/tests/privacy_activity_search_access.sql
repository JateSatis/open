-- Приватность, этап 2: «в сети», время и прочтение, поиск, защита от сбора.
-- A — владелец настроек, F — друг A, S — не друг (собеседник A), V —
-- посторонний зритель, M — участник группы, W — человек с «видно всем».
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/privacy_activity_search_access.sql
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

select extensions.similarity('a', 'b');

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000002a1', 'p2a@test.local', '{"full_name":"Зпр Аня"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000002f1', 'p2f@test.local', '{"full_name":"Зпр Фёдор"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000002b1', 'p2s@test.local', '{"full_name":"Зпр Семён"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000002c1', 'p2v@test.local', '{"full_name":"Зпр Вера"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000002d1', 'p2m@test.local', '{"full_name":"Зпр Мила"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000002e1', 'p2w@test.local', '{"full_name":"Зпр Вадим"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000201', 'p2z@test.local', '{"full_name":"Зпр Никогда"}', 'authenticated', 'authenticated');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000002a1';
  f uuid := '00000000-0000-4000-8000-0000000002f1';
  s uuid := '00000000-0000-4000-8000-0000000002b1';
  v uuid := '00000000-0000-4000-8000-0000000002c1';
  m uuid := '00000000-0000-4000-8000-0000000002d1';
  w uuid := '00000000-0000-4000-8000-0000000002e1';
  z uuid := '00000000-0000-4000-8000-000000000201';
  dm_as uuid;
  dm_fw uuid;
  grp uuid;
  friends_grp uuid;
  msg_a uuid;
  msg_s uuid;
  msg_w uuid;
  row_a record;
  got text;
  n int;
  ok boolean;
begin
  -- ---------------------------------------------------------------- данные
  perform pg_temp.as_owner();

  update public.profiles set username = 'zprannya' where id = a;
  update public.profiles set username = 'zprvadim' where id = w;
  update public.profiles set username = 'zprfedor' where id = f;

  -- Взрослые, всё «Все»; A — «Только друзьям» по трём настройкам этапа.
  update public.privacy_settings set
    activity_status_visibility = 'everyone',
    message_activity_metadata_visibility = 'everyone',
    account_search_visibility = 'everyone',
    profile_identity_masking = 'everyone',
    dialogue_participant_name_masking = 'everyone',
    avatar_visibility = 'everyone';
  update public.privacy_settings set
    activity_status_visibility = 'friends',
    message_activity_metadata_visibility = 'friends',
    account_search_visibility = 'friends'
  where user_id = a;

  insert into public.friendships (requester_id, addressee_id, status, accepted_at)
  values (a, f, 'accepted', now()), (f, m, 'accepted', now());

  insert into public.chats (kind, created_by) values ('direct', a) returning id into dm_as;
  insert into public.chat_members (chat_id, user_id) values (dm_as, a), (dm_as, s);
  insert into public.messages (chat_id, author_id, kind, text)
  values (dm_as, a, 'text', 'Зпрслово от Ани') returning id into msg_a;
  insert into public.messages (chat_id, author_id, kind, text)
  values (dm_as, s, 'text', 'Ответ Семёна') returning id into msg_s;

  insert into public.chats (kind, created_by) values ('direct', f) returning id into dm_fw;
  insert into public.chat_members (chat_id, user_id) values (dm_fw, f), (dm_fw, w);
  insert into public.messages (chat_id, author_id, kind, text)
  values (dm_fw, w, 'text', 'Зпроткрыто от Вадима') returning id into msg_w;

  insert into public.chats (kind, created_by, owner_id, title)
  values ('group', a, a, 'Зпр группа') returning id into grp;
  insert into public.chat_members (chat_id, user_id) values (grp, a), (grp, s), (grp, m), (grp, w), (grp, f);
  insert into public.messages (chat_id, author_id, kind, text)
  values (grp, a, 'text', 'Зпргрупповое от Ани'), (grp, w, 'text', 'Вадим в группе');

  insert into public.chats (kind, created_by, owner_id, title)
  values ('group', a, a, 'Зпр друзья') returning id into friends_grp;
  insert into public.chat_members (chat_id, user_id) values (friends_grp, a), (friends_grp, f);

  -- A в сети, Z ни разу не заходил.
  insert into public.user_presence (user_id, last_seen_at, online_until)
  values (a, now(), now() + interval '2 minutes'), (w, now() - interval '1 hour', null);

  -- ============================================================ 1. В сети
  perform pg_temp.act_as(f);
  select * into row_a from public.activity_statuses(array[a]);
  perform pg_temp.check('К1.1 друг видит «в сети» и время', row_a.online and row_a.last_seen_at is not null);

  perform pg_temp.act_as(s);
  select * into row_a from public.activity_statuses(array[a]);
  perform pg_temp.check('К1.1 посторонний — неизвестно', not row_a.online and row_a.last_seen_at is null);
  select (online, last_seen_at)::text into got from public.activity_statuses(array[z]);
  perform pg_temp.check('К1.1 скрытое неотличимо от ни разу не заходившего',
    got = (row_a.online, row_a.last_seen_at)::text, got);
  select (online, last_seen_at is not null)::text into got from public.activity_statuses(array[w]);
  perform pg_temp.check('К1.7 «видно всем» — время видно', got = '(f,t)', got);

  begin
    perform 1 from public.user_presence;
    perform pg_temp.check('К1.3 user_presence закрыта', false);
  exception when insufficient_privilege then
    perform pg_temp.check('К1.3 user_presence закрыта', true);
  end;

  begin
    execute 'select last_seen_at from public.profiles limit 1';
    perform pg_temp.check('К1.3 last_seen_at нет в profiles', false);
  exception when undefined_column then
    perform pg_temp.check('К1.3 last_seen_at нет в profiles', true);
  end;

  perform pg_temp.as_owner();
  update public.privacy_settings set activity_status_visibility = 'nobody' where user_id = a;

  perform pg_temp.act_as(f);
  select * into row_a from public.activity_statuses(array[a]);
  perform pg_temp.check('К1.2 «никому» — и друг не видит', not row_a.online and row_a.last_seen_at is null);

  perform pg_temp.act_as(a);
  select * into row_a from public.activity_statuses(array[a]);
  perform pg_temp.check('К1.2 сам видит свой статус', row_a.online);

  -- К1.6: смена действует со следующего запроса.
  perform pg_temp.as_owner();
  update public.privacy_settings set activity_status_visibility = 'everyone' where user_id = a;
  perform pg_temp.act_as(s);
  select * into row_a from public.activity_statuses(array[a]);
  perform pg_temp.check('К1.6 «все» — посторонний видит', row_a.online);
  perform pg_temp.as_owner();
  update public.privacy_settings set activity_status_visibility = 'nobody' where user_id = a;
  perform pg_temp.act_as(s);
  select * into row_a from public.activity_statuses(array[a]);
  perform pg_temp.check('К1.6 сразу после «никому» — неизвестно', not row_a.online and row_a.last_seen_at is null);

  -- «Печатает»
  perform pg_temp.as_owner();
  update public.privacy_settings set activity_status_visibility = 'friends' where user_id = a;
  perform pg_temp.act_as(a);
  perform pg_temp.check('К1.5 друзья, в группе не-друг — никуда', public.my_typing_audience(grp) = 'none',
    public.my_typing_audience(grp));
  perform pg_temp.check('К1.5 друзья, все участники друзья — в топик участников',
    public.my_typing_audience(friends_grp) = 'members', public.my_typing_audience(friends_grp));
  perform pg_temp.act_as(w);
  perform pg_temp.check('К1.7 «видно всем» — в топик чата', public.my_typing_audience(grp) = 'chat');
  perform pg_temp.act_as(v);
  perform pg_temp.check('не участник не печатает', public.my_typing_audience(grp) = 'none');

  perform pg_temp.act_as(s);
  perform pg_temp.check('К1.5 посторонний не слушает топик участников',
    not public.realtime_topic_member('chat-members:' || friends_grp, 'chat-members:'));
  perform pg_temp.act_as(f);
  perform pg_temp.check('участник слушает топик участников',
    public.realtime_topic_member('chat-members:' || friends_grp, 'chat-members:'));
  perform pg_temp.act_as(v);
  perform pg_temp.check('посторонний не пишет в топик чата',
    not public.realtime_topic_member('chat:' || grp, 'chat:'));
  perform pg_temp.check('мусорный топик — нет', not public.realtime_topic_member('chat:abc', 'chat:'));

  -- ============================================================ 2. Время
  perform pg_temp.as_owner();
  perform pg_temp.check('признак: личка A–S скрывает время',
    (select time_restricted from public.chats where id = dm_as));
  perform pg_temp.check('признак: личка F–W открыта',
    not (select time_restricted from public.chats where id = dm_fw));

  -- S — участник, не друг.
  perform pg_temp.act_as(s);
  select count(*) filter (where created_at is not null or edited_at is not null or read_at is not null)::int
  into n from public.message_rows where chat_id = dm_as;
  perform pg_temp.check('К2.1 S: у сообщений лички нет времени', n = 0, n::text);
  perform pg_temp.check('К2.1 S: порядок — номером',
    (select count(*) from public.message_rows where chat_id = dm_as and seq is not null) = 2);

  begin
    perform created_at from public.messages where chat_id = dm_as;
    perform pg_temp.check('К2.7 messages.created_at закрыт', false);
  exception when insufficient_privilege then
    perform pg_temp.check('К2.7 messages.created_at закрыт', true);
  end;

  begin
    perform last_read_at from public.chat_members where chat_id = dm_as;
    perform pg_temp.check('К2.7 chat_members.last_read_at закрыт', false);
  exception when insufficient_privilege then
    perform pg_temp.check('К2.7 chat_members.last_read_at закрыт', true);
  end;

  begin
    perform created_at from public.attachments limit 1;
    perform pg_temp.check('К2.7 attachments.created_at закрыт', false);
  exception when insufficient_privilege then
    perform pg_temp.check('К2.7 attachments.created_at закрыт', true);
  end;

  perform pg_temp.check('К2.7 chat_read_up_to скрыт',
    (select public.chat_read_up_to(c) from public.chat_rows c where c.id = dm_as) is null);
  perform pg_temp.check('К2.7 last_message_at скрыт',
    (select public.last_message_at(c) from public.chat_rows c where c.id = dm_as) is null);
  perform pg_temp.check('К2.7 chat_people без отметок',
    not exists (select 1 from public.chat_people(array[dm_as]) where last_read_at is not null or joined_at is not null));
  perform pg_temp.check('К2.7 my_chat_list без момента входа',
    (select entered_at from public.my_chat_list() where chat_id = dm_as) is null);
  perform pg_temp.check('К2.7 search_messages без времени',
    exists (select 1 from public.search_messages('зпрслово') where message_id = msg_a and created_at is null));
  perform pg_temp.check('К2.7 search_chat_messages без времени',
    exists (select 1 from public.search_chat_messages(dm_as, 'зпрслово') where message_id = msg_a and created_at is null));

  -- V — посторонний.
  perform pg_temp.act_as(v);
  perform pg_temp.check('К2.2 V: время лички скрыто',
    not exists (select 1 from public.message_rows where chat_id = dm_as and created_at is not null));
  perform pg_temp.check('К2.5 V: в группе с A времени нет ни у одного сообщения',
    not exists (select 1 from public.message_rows where chat_id = grp and created_at is not null));
  perform pg_temp.check('К2.10 V: в открытой личке время есть',
    (select count(*) from public.message_rows where chat_id = dm_fw and created_at is not null) = 1);

  -- F — друг A: время лички A–S видно.
  perform pg_temp.act_as(f);
  perform pg_temp.check('К2.3 друг видит время, даты и прочтение',
    (select count(*) from public.message_rows where chat_id = dm_as and created_at is not null) = 2);
  perform pg_temp.check('К2.3 друг: last_message_at виден',
    (select public.last_message_at(c) from public.chat_rows c where c.id = dm_as) is not null);

  -- К2.8: просмотр A сообщения S не виден S счётчиком.
  perform pg_temp.act_as(a);
  perform public.record_message_views(dm_as, array[msg_s], gen_random_uuid());
  perform pg_temp.act_as(s);
  perform pg_temp.check('К2.8 S не видит просмотра участника',
    (select views_count from public.message_rows where id = msg_s) = 0,
    (select views_count::text from public.message_rows where id = msg_s));
  perform pg_temp.check('К2.8 S не видит прочтения',
    (select read_at from public.message_rows where id = msg_s) is null);
  perform pg_temp.act_as(v);
  perform public.record_message_views(dm_as, array[msg_s], gen_random_uuid());
  perform pg_temp.act_as(s);
  perform pg_temp.check('К2.8 просмотр постороннего S видит',
    (select views_count from public.message_rows where id = msg_s) = 1);
  perform pg_temp.act_as(f);
  perform pg_temp.check('друг видит все просмотры и прочтение',
    (select views_count = 2 and read_at is not null from public.message_rows where id = msg_s));

  -- Взаимность: A скрыл время от S — и сам не видит прочтения S.
  perform pg_temp.act_as(s);
  perform public.record_message_views(dm_as, array[msg_a], gen_random_uuid());
  perform pg_temp.act_as(a);
  perform pg_temp.check('К5 взаимность: A не видит прочтения S, время видит',
    (select read_at is null and created_at is not null from public.message_rows where id = msg_a));
  perform pg_temp.check('К5 взаимность: отметка S в chat_people скрыта от A',
    (select last_read_at is null from public.chat_people(array[dm_as]) where user_id = s));
  perform pg_temp.check('К5 взаимность: просмотр S не в счётчике у A',
    (select views_count from public.message_rows where id = msg_a) = 0);
  perform pg_temp.act_as(f);
  perform pg_temp.check('друг видит прочтение S сообщения A',
    (select read_at is not null from public.message_rows where id = msg_a));

  -- К2.4: «никому» — и друг не видит, сам A видит.
  perform pg_temp.as_owner();
  update public.privacy_settings set message_activity_metadata_visibility = 'nobody' where user_id = a;
  perform pg_temp.act_as(f);
  perform pg_temp.check('К2.4 «никому» — друг без времени',
    not exists (select 1 from public.message_rows where chat_id = dm_as and created_at is not null));
  perform pg_temp.act_as(a);
  perform pg_temp.check('К2.4 сам A видит время своего чата… если S не скрывает',
    (select count(*) from public.message_rows where chat_id = dm_as and created_at is not null) = 2);

  -- К2.9: «все» → «друзья» — признак и скрытие сразу.
  perform pg_temp.as_owner();
  update public.privacy_settings set message_activity_metadata_visibility = 'everyone' where user_id = a;
  perform pg_temp.check('К2.9 «все» — признак снят',
    not (select time_restricted from public.chats where id = dm_as));
  perform pg_temp.act_as(s);
  perform pg_temp.check('К2.9 «все» — S видит время',
    (select count(*) from public.message_rows where chat_id = dm_as and created_at is not null) = 2);
  perform pg_temp.as_owner();
  update public.privacy_settings set message_activity_metadata_visibility = 'friends' where user_id = a;
  perform pg_temp.act_as(s);
  perform pg_temp.check('К2.9 «друзья» — у S время пропало сразу',
    not exists (select 1 from public.message_rows where chat_id = dm_as and created_at is not null));

  -- Состав: ушёл скрывающий — признак снят.
  perform pg_temp.as_owner();
  delete from public.chat_members where chat_id = grp and user_id = a;
  perform pg_temp.check('признак снят, когда скрывающий ушёл',
    not (select time_restricted from public.chats where id = grp));
  insert into public.chat_members (chat_id, user_id) values (grp, a);
  perform pg_temp.check('признак встал, когда скрывающий вступил',
    (select time_restricted from public.chats where id = grp));

  -- Отправка участником без чтения времени: вставка + вложения работают.
  perform pg_temp.act_as(s);
  insert into public.messages (id, chat_id, author_id, kind, text)
  values (gen_random_uuid(), dm_as, s, 'text', 'Новое без времени');
  perform pg_temp.check('участник отправляет текст прямой вставкой', true);
  perform public.send_media_message(dm_as, 'с фото', '[{"url":"https://x/y.jpg","mime_type":"image/jpeg","width":1,"height":1}]'::jsonb);
  perform pg_temp.check('участник отправляет альбом функцией', true);

  -- ============================================================ 3. Поиск
  perform pg_temp.act_as(s);
  perform pg_temp.check('К3.1 S не находит A по @имени',
    not exists (select 1 from public.search_entities('@zprannya') where entity_kind = 'person' and id = a));
  perform pg_temp.check('К3.1 S не находит A по имени в людях',
    not exists (select 1 from public.search_entities('Зпр Аня') where entity_kind = 'person' and id = a));
  perform pg_temp.check('К3.5 S находит человека с «видно всем»',
    exists (select 1 from public.search_entities('@zprvadim') where entity_kind = 'person' and id = w));

  perform pg_temp.act_as(f);
  perform pg_temp.check('К3.1 друг находит A',
    exists (select 1 from public.search_entities('@zprannya') where entity_kind = 'person' and id = a));

  -- Поиск внутри чата: V — посетитель группы.
  perform pg_temp.act_as(v);
  perform pg_temp.check('К3.2 посетитель не находит слово A внутри чата',
    not exists (select 1 from public.search_chat_messages(grp, 'зпргрупповое')));
  perform pg_temp.check('К3.2 посетитель не насчитывает совпадений',
    public.count_chat_search(grp, 'зпргрупповое') = 0);
  perform pg_temp.check('К3.5 посетитель находит слово открытого автора',
    exists (select 1 from public.search_chat_messages(dm_fw, 'зпроткрыто')));
  perform pg_temp.act_as(m);
  perform pg_temp.check('К3.2 участник находит слово A внутри своего чата',
    exists (select 1 from public.search_chat_messages(grp, 'зпргрупповое')));
  perform pg_temp.check('К3.2 участник находит в глобальном поиске сообщений',
    exists (select 1 from public.search_messages('зпргрупповое')));

  perform pg_temp.as_owner();
  update public.privacy_settings set account_search_visibility = 'nobody' where user_id = a;
  perform pg_temp.act_as(f);
  perform pg_temp.check('К3.3 «никому» — друг не находит',
    not exists (select 1 from public.search_entities('@zprannya') where entity_kind = 'person' and id = a));
  perform pg_temp.act_as(m);
  perform pg_temp.check('К3.3 участник внутри чата находит и при «никому»',
    exists (select 1 from public.search_chat_messages(grp, 'зпргрупповое')));

  -- К3.4: недавние перепроверяются.
  perform pg_temp.act_as(s);
  perform pg_temp.check('К3.4 сохранённый A больше не показывается',
    not exists (select 1 from public.recheck_recent_searches(array[a, w], null) where id = a)
    and exists (select 1 from public.recheck_recent_searches(array[a, w], null) where id = w));

  -- ============================================================ 4. Сбор
  perform pg_temp.act_as(w);
  select string_agg(id::text, ',' order by id) into got from public.search_people('', null, null, 1000);
  perform pg_temp.check('К4.1 «Новый чат» без запроса — друзья и люди из моих чатов',
    got is not null and position(f::text in got) > 0 and position(a::text in got) > 0
      and position(v::text in got) = 0, got);
  perform pg_temp.check('К4.1 человек вне знакомых — только поиском',
    exists (select 1 from public.search_people('Зпр Вера')));
  perform pg_temp.check('К4.2 страница людей не больше 50',
    (select count(*) from public.search_people('зпр', null, null, 1000)) <= 50);

  perform pg_temp.as_owner();
  insert into public.search_request_log (user_id, kind)
  select v, 'people' from generate_series(1, 120);
  perform pg_temp.act_as(v);
  begin
    perform public.search_people('зпр');
    perform pg_temp.check('К4.3 сверх лимита — отказ', false);
  exception when sqlstate 'OPN06' then
    perform pg_temp.check('К4.3 сверх лимита — отказ OPN06', true);
  end;
  perform pg_temp.as_owner();
  update public.search_request_log set created_at = now() - interval '2 hours' where user_id = v;
  perform pg_temp.act_as(v);
  perform public.search_entities('зпр');
  perform pg_temp.check('К4.3 после окна снова работает', true);

  -- ============================================================ ревью
  perform pg_temp.as_owner();
  delete from public.search_request_log;
  perform pg_temp.act_as(v);
  perform pg_temp.check('«@» — не каталог: только знакомые',
    not exists (select 1 from public.search_people('@', null, null, 50) where id in (a, w, f, m)));

  perform pg_temp.act_as(a);
  perform pg_temp.check('reads_visible: A не видит прочтения в личке с S',
    (select bool_and(not reads_visible and time_visible) from public.message_rows where chat_id = dm_as));

  -- Два сеанса: один ушёл в фон, другой открыт — «в сети».
  perform pg_temp.as_owner();
  delete from public.user_presence where user_id = w;
  insert into public.user_presence (user_id, session_id, last_seen_at, online_until) values
    (w, gen_random_uuid(), now(), null),
    (w, gen_random_uuid(), now() - interval '10 seconds', now() + interval '1 minute');
  perform pg_temp.act_as(s);
  perform pg_temp.check('в сети, пока открыт хоть один сеанс',
    (select online from public.activity_statuses(array[w])));

  -- Дружба пропала — сигнал «перечитай» в скрывающий чат.
  perform pg_temp.as_owner();
  delete from realtime.messages where topic = 'chat:' || friends_grp;
  delete from public.friendships where least(requester_id, addressee_id) = least(a, f)
    and greatest(requester_id, addressee_id) = greatest(a, f);
  perform pg_temp.check('дружба пропала — time_visibility_changed',
    exists (select 1 from realtime.messages
      where topic = 'chat:' || friends_grp and event = 'time_visibility_changed'));

  -- Вступил скрывающий — сигнал.
  delete from realtime.messages where topic = 'chat:' || dm_fw;
  insert into public.chat_members (chat_id, user_id) values (dm_fw, a);
  perform pg_temp.check('вступил скрывающий — time_visibility_changed',
    exists (select 1 from realtime.messages
      where topic = 'chat:' || dm_fw and event = 'time_visibility_changed'));
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
