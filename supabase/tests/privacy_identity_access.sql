-- Приватность, этап 4: подмена имени, username и фото.
-- A — скрыт «только друзьям» (имя, имя в диалогах, фото), F — друг A,
-- S — посторонний, M — участник X не друг A, E — открыт всем, участник X.
-- X — группа A, M, E; Y — личка A и F; Z — группа E и M без A (комментарий A
-- как посетителя); W — группа S и E (островок с сообщением из X).
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/privacy_identity_access.sql
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
language sql as $$ insert into results (name, ok, detail) values (name, coalesce(ok, false), detail) $$;

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

/** Код ошибки выражения или 'ok', если оно прошло. */
create function pg_temp.code_of(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

grant execute on function pg_temp.check(text, boolean, text) to authenticated;
grant execute on function pg_temp.code_of(text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000004a1', 'p4a@test.local', '{"full_name":"Идн Анна"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000004f1', 'p4f@test.local', '{"full_name":"Идн Фёдор"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000004c1', 'p4s@test.local', '{"full_name":"Идн Сева"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000004d1', 'p4m@test.local', '{"full_name":"Идн Марк"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000004e1', 'p4e@test.local', '{"full_name":"Идн Эльза"}', 'authenticated', 'authenticated');

-- Задержка публикации для зрителей (этап 6) у защитных настроек включена — здесь проверяется не она.
update public.privacy_settings set public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like '%@test.local');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000004a1';
  f uuid := '00000000-0000-4000-8000-0000000004f1';
  s uuid := '00000000-0000-4000-8000-0000000004c1';
  m uuid := '00000000-0000-4000-8000-0000000004d1';
  e uuid := '00000000-0000-4000-8000-0000000004e1';
  a_avatar text := '00000000-0000-4000-8000-0000000004a1/me.jpg';
  emoji text;
  x uuid;
  y uuid;
  z uuid;
  w uuid;
  msg_x uuid;
  msg_x2 uuid;
  msg_y uuid;
  msg_z uuid;
  msg_e uuid;
  com_x uuid;
  com_z uuid;
  stream uuid;
  alias text;
  alias_old text;
  alias_x text;
  alias_y text;
  id_x uuid;
  id_y uuid;
  r record;
  n int;
  t text;
  res jsonb;
begin
  -- ---------------------------------------------------------------- данные
  perform pg_temp.as_owner();

  select re.emoji into emoji from public.reaction_emojis re limit 1;

  update public.profiles set username = 'idnanna', bio = 'Анна о себе', status = 'Анна в отпуске', avatar_url = a_avatar
  where id = a;
  update public.profiles set username = 'idnelza' where id = e;
  update public.profiles set username = 'idnfedor' where id = f;

  update public.privacy_settings set
    profile_identity_masking = 'friends',
    dialogue_participant_name_masking = 'friends',
    avatar_visibility = 'friends',
    account_search_visibility = 'everyone',
    message_activity_metadata_visibility = 'everyone',
    activity_status_visibility = 'everyone',
    friends_list_visibility = 'everyone'
  where user_id = a;

  update public.privacy_settings set
    profile_identity_masking = 'everyone',
    dialogue_participant_name_masking = 'everyone',
    avatar_visibility = 'everyone',
    account_search_visibility = 'everyone',
    message_activity_metadata_visibility = 'everyone',
    activity_status_visibility = 'everyone',
    friends_list_visibility = 'everyone'
  where user_id in (f, s, m, e);

  insert into public.friendships (requester_id, addressee_id, status, accepted_at)
  values (a, f, 'accepted', now());

  select identity_alias into alias from public.privacy_settings where user_id = a;

  insert into public.chats (kind, created_by, owner_id, title, founding_member_ids)
  values ('group', a, a, 'Идн X', array[a, m, e]) returning id into x;
  insert into public.chat_members (chat_id, user_id) values (x, a), (x, m), (x, e);

  insert into public.chats (kind, created_by, founding_member_ids)
  values ('direct', a, array[a, f]) returning id into y;
  insert into public.chat_members (chat_id, user_id) values (y, a), (y, f);

  insert into public.chats (kind, created_by, owner_id, title)
  values ('group', e, e, 'Идн Z') returning id into z;
  insert into public.chat_members (chat_id, user_id) values (z, e), (z, m);

  insert into public.chats (kind, created_by, owner_id, title)
  values ('group', s, s, 'Идн W') returning id into w;
  insert into public.chat_members (chat_id, user_id) values (w, s), (w, e);

  -- S подписан на X: личный топик получает сообщения X.
  perform pg_temp.act_as(s);
  perform public.subscribe_to_chat(x);

  perform pg_temp.act_as(a);
  msg_x := gen_random_uuid();
  insert into public.messages (id, chat_id, author_id, kind, text) values (msg_x, x, a, 'text', 'Привет из X');
  msg_y := gen_random_uuid();
  insert into public.messages (id, chat_id, author_id, kind, text) values (msg_y, y, a, 'text', 'Привет из Y');
  perform public.set_reaction('message', msg_x, emoji);

  perform pg_temp.act_as(e);
  msg_e := gen_random_uuid();
  insert into public.messages (id, chat_id, author_id, kind, text) values (msg_e, x, e, 'text', 'Я Эльза');
  msg_z := gen_random_uuid();
  insert into public.messages (id, chat_id, author_id, kind, text) values (msg_z, z, e, 'text', 'Сообщение в Z');

  perform pg_temp.act_as(m);
  -- Ответ M на сообщение A — цитата.
  msg_x2 := public.send_media_message(x, 'Ответ Анне', '[]'::jsonb, array[msg_x]);

  -- Комментарии A: к своему сообщению в X и посетителем — в Z.
  perform pg_temp.act_as(a);
  com_x := public.send_comment(msg_x, 'Коммент A в X');
  com_z := public.send_comment(msg_z, 'Коммент A в Z');
  perform public.set_reaction('comment', com_z, emoji);

  -- E пересылает сообщение A из X в W.
  perform pg_temp.act_as(e);
  perform public.forward_messages(w, x, array[msg_x]);

  -- ------------------------------------------------- К1: профиль и поиск
  perform pg_temp.act_as(s);
  select * into r from public.profile_cards(array[a]);
  perform pg_temp.check('К1.1 S видит псевдоним вместо имени',
    r.display_name = alias and r.display_name <> 'Идн Анна' and r.masked, r.display_name);
  perform pg_temp.check('К1.1 S не видит username, «О себе», статус и фото',
    r.username is null and r.bio is null and r.status is null and r.avatar_url is null);

  perform pg_temp.act_as(f);
  select * into r from public.profile_cards(array[a]);
  perform pg_temp.check('К1.1 F видит настоящее',
    r.display_name = 'Идн Анна' and r.username = 'idnanna' and r.bio = 'Анна о себе'
      and r.avatar_url = a_avatar and not r.masked);

  perform pg_temp.act_as(s);
  perform pg_temp.check('К1.2 поиск людей по настоящему имени — пусто',
    not exists (select 1 from public.search_people('Идн Анна') p where p.id = a));
  perform pg_temp.check('К1.2 поиск по @username — пусто',
    not exists (select 1 from public.search_entities('@idnanna') e2 where e2.peer_id = a)
      and not exists (select 1 from public.search_people('idnanna') p where p.id = a));
  select * into r from public.search_people(alias) p where p.id = a;
  perform pg_temp.check('К1.2 поиск по псевдониму находит, без username',
    r.id = a and r.display_name = alias and r.username is null, coalesce(r.display_name, 'не найден'));
  select * into r from public.search_entities(alias) e2 where e2.peer_id = a;
  perform pg_temp.check('К1.2 общий поиск по псевдониму находит, без username',
    r.title = alias and r.username is null, coalesce(r.title, 'не найден'));

  perform pg_temp.check('К1.3 select имени из profiles — отказ',
    pg_temp.code_of('select display_name from public.profiles limit 1') = '42501');
  perform pg_temp.check('К1.3 select username, фото, «О себе» из profiles — отказ',
    pg_temp.code_of('select username from public.profiles limit 1') = '42501'
      and pg_temp.code_of('select avatar_url from public.profiles limit 1') = '42501'
      and pg_temp.code_of('select bio from public.profiles limit 1') = '42501');
  perform pg_temp.check('К1.3 embed профиля в выборке — отказ',
    pg_temp.code_of('select p.display_name from public.message_rows m join public.profiles p on p.id = m.author_id limit 1') = '42501');

  -- ------------------------------------------------- К2: диалоги
  select author_name, author_id into alias_x, id_x from public.message_rows where id = msg_x;
  select author_name, author_id into alias_y, id_y from public.message_rows where id = msg_y;
  perform pg_temp.check('К2.1 в X — псевдоним X, в Y — другой, общий — третий',
    alias_x is not null and alias_y is not null and alias_x <> alias_y
      and alias_x <> alias and alias_y <> alias and alias_x <> 'Идн Анна',
    alias_x || ' / ' || alias_y || ' / ' || alias);
  perform pg_temp.check('К2.3 настоящего id A нет, непрозрачные id в X и Y разные',
    id_x <> a and id_y <> a and id_x <> id_y
      and (select author_opaque from public.message_rows where id = msg_x));

  perform pg_temp.check('К2.2 цитата в X — тот же псевдоним',
    exists (
      select 1 from public.message_replies mr
      join public.message_rows q on q.id = mr.quoted_id
      where mr.message_id = msg_x2 and q.author_name = alias_x and q.author_id = id_x
    ));
  perform pg_temp.check('К2.2 островок в W — псевдоним X',
    exists (
      select 1 from public.message_rows fw
      join public.forward_items fi on fi.forward_id = fw.id
      join public.message_rows o on o.id = fi.message_id
      where fw.chat_id = w and o.author_name = alias_x and o.author_id = id_x
    ));
  perform pg_temp.check('К2.2 участники X — тот же псевдоним и id',
    exists (select 1 from public.chat_people(array[x]) p where p.user_id = id_x and p.display_name = alias_x and p.opaque)
      and not exists (select 1 from public.chat_people(array[x, y]) p where p.user_id = a));
  perform pg_temp.check('К2.2 комментарий A к сообщению X — псевдоним X',
    exists (select 1 from public.comment_rows c where c.id = com_x and c.author_name = alias_x and c.author_id = id_x));
  perform pg_temp.check('К2.2 реакция A на сообщение X — псевдоним X',
    exists (
      select 1 from public.message_rows mx, lateral public.reactors(mx) rr
      where mx.id = msg_x and rr.user_id = id_x and rr.display_name = alias_x
    ));
  perform pg_temp.check('К2.3 в строках чатов X и Y нет настоящего id A',
    not exists (
      select 1 from public.chat_rows c
      where c.id in (x, y) and a in (c.owner_id, c.created_by, c.last_message_author_id)
    ));
  perform pg_temp.check('К2.3 название лички Y — псевдоним',
    (select public.chat_display_name(c) from public.chat_rows c where c.id = y) not like '%Идн Анна%');
  perform pg_temp.check('К2.3 сырые колонки с людьми — отказ',
    pg_temp.code_of('select author_id from public.messages limit 1') = '42501'
      and pg_temp.code_of('select text from public.messages limit 1') = '42501'
      and pg_temp.code_of('select author_id from public.comments limit 1') = '42501'
      and pg_temp.code_of('select owner_id from public.chats limit 1') = '42501'
      and pg_temp.code_of('select founding_member_ids from public.chats limit 1') = '42501'
      and pg_temp.code_of('select host_id from public.streams limit 1') = '42501');
  select count(*) into n from public.chat_members where chat_id in (x, y);
  perform pg_temp.check('К2.3 участники чужого чата напрямую не читаются', n = 0, n::text);
  select count(*) into n from public.reactions where user_id = a;
  perform pg_temp.check('К2.3 чужие реакции напрямую не читаются', n = 0, n::text);
  perform pg_temp.check('К2.3 чаты A в его профиле — без X и Y',
    not exists (select 1 from public.list_person_chats(a) c where c.id in (x, y)));
  perform pg_temp.check('К2.3 поиск в X — автор под псевдонимом X',
    exists (select 1 from public.search_chat_messages(x, 'Привет') h where h.author_id = id_x and h.author_name = alias_x)
      and not exists (select 1 from public.search_chat_messages(x, 'Привет') h where h.author_id = a));

  perform pg_temp.check('К2.4 E в X — настоящее имя и id',
    exists (select 1 from public.message_rows where id = msg_e and author_id = e and author_name = 'Идн Эльза' and not author_opaque));

  perform pg_temp.check('К1.6 комментарий A в Z (посетитель) — общий псевдоним, настоящий id',
    exists (select 1 from public.comment_rows c where c.id = com_z and c.author_id = a and c.author_name = alias and not c.author_opaque));
  perform pg_temp.check('К1.6 реакция A на комментарий — общий псевдоним',
    exists (
      select 1 from public.comment_rows cz, lateral public.reactors(cz) rr
      where cz.id = com_z and rr.user_id = a and rr.display_name = alias and rr.avatar_url is null
    ));
  perform pg_temp.check('К1.6 A в списке друзей F — псевдоним без username',
    exists (select 1 from public.list_friends(f) l where l.user_id = a and l.display_name = alias and l.username is null));

  perform pg_temp.act_as(m);
  perform pg_temp.check('К2.5 участник X не друг — общий псевдоним, настоящий id',
    exists (select 1 from public.message_rows where id = msg_x and author_id = a and author_name = alias and not author_opaque));
  perform pg_temp.check('К2.5 участник X не друг — в участниках общий псевдоним',
    exists (select 1 from public.chat_people(array[x]) p where p.user_id = a and p.display_name = alias and not p.opaque));
  perform pg_temp.check('К2.5 участник видит владельца настоящим id',
    (select owner_id from public.chat_rows where id = x) = a);

  perform pg_temp.act_as(f);
  perform pg_temp.check('К2.5 друг F в X посторонним — настоящее',
    exists (select 1 from public.message_rows where id = msg_x and author_id = a and author_name = 'Идн Анна'));

  perform pg_temp.act_as(a);
  perform pg_temp.check('К2.6 своё у A — своё',
    exists (select 1 from public.message_rows where id = msg_x and author_id = a and author_name = 'Идн Анна'));

  -- ------------------------------------------------- рассылки
  perform pg_temp.as_owner();
  -- Рассылка о новом сообщении — отложенный триггер: выполнить сейчас.
  set constraints all immediate;
  perform pg_temp.check('К1.3 в общем топике X нет id и имени A',
    not exists (
      select 1 from realtime.messages rm
      where rm.topic in ('chat:' || x, 'chat:' || y)
        and (rm.payload::text like '%' || a || '%' or rm.payload::text like '%Идн Анна%')
    ));
  select rm.payload into res from realtime.messages rm
  where rm.topic = 'user:' || s and rm.event = 'new_message' and rm.payload ->> 'message_id' = msg_x::text;
  perform pg_temp.check('К1.3 личный топик подписчика S — псевдоним X, непрозрачный id',
    res ->> 'author_name' = alias_x and res ->> 'author_id' = id_x::text
      and res::text not like '%' || a || '%' and res::text not like '%Идн Анна%', coalesce(res::text, 'нет'));
  select rm.payload into res from realtime.messages rm
  where rm.topic = 'user:' || m and rm.event = 'new_message' and rm.payload ->> 'message_id' = msg_x::text;
  perform pg_temp.check('К1.3 личный топик участника M — общий псевдоним',
    res ->> 'author_name' = alias, coalesce(res::text, 'нет'));

  perform pg_temp.act_as(a);
  perform pg_temp.check('печатает: A с подменой в диалогах — только участникам',
    public.my_typing_audience(x) = 'members');

  -- ------------------------------------------------- звонок
  perform pg_temp.act_as(e);
  res := public.start_call(x);
  stream := (res ->> 'stream_id')::uuid;
  perform pg_temp.as_owner();
  res := public.stream_join_info(stream, a);
  perform pg_temp.check('звонок: в токене identity не id и нет имени',
    res ->> 'identity' is not null and res ->> 'identity' <> a::text and not (res ? 'display_name'), res::text);
  perform public.stream_participant_joined('stream-' || stream, res ->> 'identity', 'PA_a', 'speaker', now());
  perform pg_temp.check('звонок: вебхук узнаёт A по identity',
    exists (select 1 from public.stream_participants where stream_id = stream and user_id = a and left_at is null));

  perform pg_temp.act_as(s);
  select * into r from public.stream_people(stream) sp where sp.identity = res ->> 'identity';
  perform pg_temp.check('звонок: S видит A псевдонимом X',
    r.user_id = id_x and r.display_name = alias_x and r.opaque, coalesce(r.display_name, 'нет'));
  perform pg_temp.check('звонок: начавший у S — не настоящий id',
    (select host_id from public.chat_live_stream(x)) = e);
  perform pg_temp.check('звонок: начавший в строке звонка — глазами смотрящего',
    (select stream_host_id from public.message_rows where stream_id = stream and system_event = 'call_started') = e);

  -- Обёртки представлений напрямую не отдают того, чего не отдаёт представление.
  perform pg_temp.check('обёртки: удалённое и чужая заявка — пусто',
    (select author_id from public.message_people(gen_random_uuid())) is null
      and (select owner_id from public.chat_row_people(gen_random_uuid())) is null);

  -- ------------------------------------------------- К1.4, К1.5
  perform pg_temp.act_as(a);
  perform public.set_privacy_setting('profile_identity_masking', 'nobody');
  perform pg_temp.act_as(f);
  perform pg_temp.check('К1.4 «никому» — и друг видит псевдоним',
    (select display_name from public.profile_cards(array[a])) = alias);
  perform pg_temp.act_as(a);
  perform pg_temp.check('К1.4 сам видит своё',
    (select display_name from public.profile_cards(array[a])) = 'Идн Анна');

  alias_old := alias;
  alias := public.regenerate_identity_alias();
  perform pg_temp.check('К1.5 другой псевдоним — новый', alias <> alias_old, alias_old || ' → ' || alias);
  perform pg_temp.act_as(s);
  perform pg_temp.check('К1.5 S видит новый, по старому не находит',
    (select display_name from public.profile_cards(array[a])) = alias
      and not exists (select 1 from public.search_people(alias_old) p where p.id = a and p.display_name = alias_old));
  perform pg_temp.act_as(a);
  perform public.regenerate_identity_alias();
  perform public.regenerate_identity_alias();
  perform public.regenerate_identity_alias();
  perform public.regenerate_identity_alias();
  perform pg_temp.check('К4.2 шестая смена за сутки — отказ OPN13',
    pg_temp.code_of('select public.regenerate_identity_alias()') = 'OPN13');

  -- ------------------------------------------------- К3: фото
  perform pg_temp.act_as(s);
  perform pg_temp.check('К3.2 S не получает файл аватара A',
    not public.avatar_object_readable(a_avatar));
  perform pg_temp.act_as(f);
  perform pg_temp.check('К3.1 F читает файл аватара A', public.avatar_object_readable(a_avatar));
  perform pg_temp.check('К3.2 прежний файл не читается никем',
    not public.avatar_object_readable('00000000-0000-4000-8000-0000000004a1/old.jpg'));
  perform pg_temp.act_as(a);
  perform public.set_privacy_setting('avatar_visibility', 'everyone');
  perform pg_temp.act_as(s);
  perform pg_temp.check('К3.3 «всем» — S видит фото',
    public.avatar_object_readable(a_avatar)
      and (select avatar_url from public.profile_cards(array[a])) = a_avatar);
  perform pg_temp.as_owner();
  perform pg_temp.check('К3.3 смена настройки — сигнал в топики чатов A',
    exists (select 1 from realtime.messages rm where rm.topic = 'chat:' || x and rm.event = 'people_changed'));

  perform pg_temp.act_as(a);
  perform pg_temp.check('К3.4 своё фото — только свой файл',
    pg_temp.code_of($q$update public.profiles set avatar_url = '00000000-0000-4000-8000-0000000004f1/x.jpg' where id = auth.uid()$q$) = '22023'
      and pg_temp.code_of($q$update public.profiles set avatar_url = 'https://example.com/a.jpg' where id = auth.uid()$q$) = '22023'
      and pg_temp.code_of($q$update public.profiles set avatar_url = '00000000-0000-4000-8000-0000000004a1/new.jpg' where id = auth.uid()$q$) = 'ok'
      and pg_temp.code_of($q$update public.profiles set avatar_url = null where id = auth.uid()$q$) = 'ok');
  t := pg_temp.code_of($q$update public.profiles set display_name = 'Идн Анна 2', bio = 'новое' where id = auth.uid()$q$);
  perform pg_temp.check('К1.7 свой профиль редактируется',
    t = 'ok' and (select display_name from public.profile_cards(array[a])) = 'Идн Анна 2', t);

  -- ------------------------------------------------- регресс
  perform pg_temp.act_as(s);
  select * into r from public.profile_cards(array[e]);
  perform pg_temp.check('К1.7 открытый всем — настоящее имя и username',
    r.display_name = 'Идн Эльза' and r.username = 'idnelza' and not r.masked);
  perform pg_temp.check('К1.7 открытого находит поиск по @username',
    exists (select 1 from public.search_entities('@idnelza') e2 where e2.peer_id = e));
end;
$$;

-- Позванному без подмены виден только позвавший (он раскрыт карточкой
-- приглашения); остальные скрывшие себя — под псевдонимом чата, пока он не
-- вступил. Отклонивший — снова посторонний.
do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000004a1';
  s uuid := '00000000-0000-4000-8000-0000000004c1';
  m uuid := '00000000-0000-4000-8000-0000000004d1';
  x uuid;
  alias text;
  seen text;
  opaque boolean;
begin
  perform pg_temp.as_owner();
  select id into x from public.chats where title = 'Идн X';
  select identity_alias into alias from public.privacy_settings where user_id = a;
  delete from public.chat_invites where chat_id = x and invitee_id = s;

  -- Позвал M: скрывшая себя A для позванного по-прежнему под псевдонимом чата.
  insert into public.chat_invites (chat_id, inviter_id, invitee_id) values (x, m, s);
  perform pg_temp.act_as(s);
  select author_name, author_opaque into seen, opaque
  from public.message_rows where chat_id = x and text = 'Привет из X';
  perform pg_temp.check('позванному другие скрывшие себя — под псевдонимом чата',
    opaque and seen <> alias, seen);
  perform pg_temp.check('позванному в составе — непрозрачный id не позвавшего',
    not exists (select 1 from public.chat_people(array[x]) p where p.user_id = a), null);

  -- Позвала A: в составе и сообщениях — то же имя, что в карточке приглашения.
  perform pg_temp.as_owner();
  delete from public.chat_invites where chat_id = x and invitee_id = s;
  insert into public.chat_invites (chat_id, inviter_id, invitee_id) values (x, a, s);
  perform pg_temp.act_as(s);
  select author_name into seen from public.message_rows where chat_id = x and text = 'Привет из X';
  perform pg_temp.check('позвавший для позванного — тем же именем, что в карточке',
    seen = alias and seen = (select inviter_name(i) from public.chat_invites i where i.chat_id = x and i.invitee_id = s),
    seen);
  perform pg_temp.check('позвавший в составе — настоящим id',
    exists (select 1 from public.chat_people(array[x]) p where p.user_id = a), null);

  perform pg_temp.as_owner();
  update public.chat_invites set status = 'declined', declined_at = now() where chat_id = x and invitee_id = s;
  perform pg_temp.act_as(s);
  select author_name into seen from public.message_rows where chat_id = x and text = 'Привет из X';
  perform pg_temp.check('отклонивший снова видит псевдоним чата', seen is not null and seen <> alias, seen);
  perform pg_temp.as_owner();
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
