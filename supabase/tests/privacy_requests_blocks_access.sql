-- Приватность, этап 3: заявки на диалог, блокировки, жалобы, автоограничения.
-- A — отправитель заявки, B — получатель, V — посторонний, F — друг B,
-- A2 — второй аккаунт A на том же устройстве, D и E — другие отправители,
-- T — аккаунт, на который жалуются, K1…K5 — блокирующие T, Q — друг T.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/privacy_requests_blocks_access.sql
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
  ('00000000-0000-4000-8000-0000000003a1', 'p3a@test.local', '{"full_name":"Блк Аня"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000003a2', 'p3a2@test.local', '{"full_name":"Блк Аня Два"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000003b1', 'p3b@test.local', '{"full_name":"Блк Борис"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000003c1', 'p3v@test.local', '{"full_name":"Блк Вера"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000003f1', 'p3f@test.local', '{"full_name":"Блк Фёдор"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000003d1', 'p3d@test.local', '{"full_name":"Блк Дина"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000003e1', 'p3e@test.local', '{"full_name":"Блк Егор"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000301', 'p3t@test.local', '{"full_name":"Блк Тимур"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000302', 'p3q@test.local', '{"full_name":"Блк Кира"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000311', 'p3k1@test.local', '{"full_name":"Блк К1"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000312', 'p3k2@test.local', '{"full_name":"Блк К2"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000313', 'p3k3@test.local', '{"full_name":"Блк К3"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000314', 'p3k4@test.local', '{"full_name":"Блк К4"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000315', 'p3k5@test.local', '{"full_name":"Блк К5"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000316', 'p3u@test.local', '{"full_name":"Блк Ульяна"}', 'authenticated', 'authenticated');

-- Задержка публикации для зрителей (этап 6) у защитных настроек включена — здесь проверяется не она.
update public.privacy_settings set public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like '%@test.local');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000003a1';
  a2 uuid := '00000000-0000-4000-8000-0000000003a2';
  a3 uuid := '00000000-0000-4000-8000-0000000003a3';
  b uuid := '00000000-0000-4000-8000-0000000003b1';
  v uuid := '00000000-0000-4000-8000-0000000003c1';
  f uuid := '00000000-0000-4000-8000-0000000003f1';
  d uuid := '00000000-0000-4000-8000-0000000003d1';
  e uuid := '00000000-0000-4000-8000-0000000003e1';
  t uuid := '00000000-0000-4000-8000-000000000301';
  q uuid := '00000000-0000-4000-8000-000000000302';
  u uuid := '00000000-0000-4000-8000-000000000316';
  ks uuid[] := array[
    '00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000312',
    '00000000-0000-4000-8000-000000000313', '00000000-0000-4000-8000-000000000314',
    '00000000-0000-4000-8000-000000000315'
  ]::uuid[];
  device uuid := gen_random_uuid();
  emoji text;
  res jsonb;
  rq uuid;
  rq_d uuid;
  rq_v uuid;
  fb uuid;
  grp_g uuid;
  grp_h uuid;
  grp_a uuid;
  grp_t uuid;
  msg_rq uuid;
  msg_g_b uuid;
  msg_h_b uuid;
  msg_h_v uuid;
  com_b uuid;
  com_a uuid;
  got text;
  n int;
  i int;
  hidden_row record;
begin
  -- ---------------------------------------------------------------- данные
  perform pg_temp.as_owner();

  select r.emoji into emoji from public.reaction_emojis r limit 1;

  update public.profiles set username = 'blkboris' where id = b;
  update public.profiles set username = 'blkvera' where id = v;
  update public.profiles set username = 'blkdina' where id = d;

  update public.privacy_settings set
    activity_status_visibility = 'everyone',
    message_activity_metadata_visibility = 'everyone',
    account_search_visibility = 'everyone',
    profile_identity_masking = 'everyone',
    dialogue_participant_name_masking = 'everyone',
    avatar_visibility = 'everyone'
  where user_id in (a, a2, b, v, f, d, e, t, q, u) or user_id = any (ks);

  insert into public.friendships (requester_id, addressee_id, status, accepted_at)
  values (f, b, 'accepted', now()), (t, q, 'accepted', now());

  -- A и A2 входили с одного телефона.
  insert into public.account_installations (user_id, installation_id) values (a, device), (a2, device);

  insert into public.user_presence (user_id, last_seen_at, online_until)
  values (b, now(), now() + interval '2 minutes');

  -- G — группа B и V, A в ней нет. H — группа, где A и B оба участники.
  insert into public.chats (kind, created_by, owner_id, title)
  values ('group', b, b, 'Блк G') returning id into grp_g;
  insert into public.chat_members (chat_id, user_id) values (grp_g, b), (grp_g, v);
  insert into public.chats (kind, created_by, owner_id, title)
  values ('group', v, v, 'Блк H') returning id into grp_h;
  insert into public.chat_members (chat_id, user_id) values (grp_h, a), (grp_h, b), (grp_h, v);
  -- Своя группа A — для приглашений.
  insert into public.chats (kind, created_by, owner_id, title)
  values ('group', a, a, 'Блк A') returning id into grp_a;
  insert into public.chat_members (chat_id, user_id) values (grp_a, a), (grp_a, v);

  insert into public.messages (chat_id, author_id, kind, text)
  values (grp_g, v, 'text', 'Вера в G');
  insert into public.messages (chat_id, author_id, kind, text)
  values (grp_g, b, 'text', 'Борис в G') returning id into msg_g_b;
  insert into public.messages (chat_id, author_id, kind, text)
  values (grp_g, v, 'text', 'Вера в G ещё');
  insert into public.messages (chat_id, author_id, kind, text)
  values (grp_h, b, 'text', 'Борис в H') returning id into msg_h_b;
  insert into public.messages (chat_id, author_id, kind, text)
  values (grp_h, v, 'text', 'Вера в H') returning id into msg_h_v;

  -- ============================================================ 1. Заявка
  perform pg_temp.act_as(a);

  res := public.create_chat(array[b]);
  perform pg_temp.check('К1.1 без текста не-другу — request_needed, чат не создан',
    res ->> 'outcome' = 'request_needed'
      and not exists (select 1 from public.chat_rows where created_by = a and kind = 'direct'),
    res::text);

  res := public.create_chat(array[b], null, null, 'Привет, это заявка');
  rq := (res ->> 'chat_id')::uuid;
  select id into msg_rq from public.message_rows where chat_id = rq;

  perform pg_temp.as_owner();
  perform pg_temp.check('К1.1 заявка: чат, A участник, B — заявка, одно текстовое',
    (select request_pending from public.chats where id = rq)
      and (select array_agg(user_id) from public.chat_members where chat_id = rq) = array[a]
      and exists (select 1 from public.chat_invites where chat_id = rq and invitee_id = b and status = 'pending')
      and (select count(*) from public.messages where chat_id = rq and kind = 'text') = 1);

  perform pg_temp.act_as(a);
  got := pg_temp.code_of(format(
    $q$insert into public.messages (chat_id, author_id, kind, text) values (%L, %L, 'text', 'второе')$q$, rq, a));
  perform pg_temp.check('К1.2 второе сообщение прямым INSERT — OPN07', got = 'OPN07', got);
  got := pg_temp.code_of(format(
    $q$select public.send_media_message(%L, null, '[{"url":"https://cdn.test/p.jpg","mime_type":"image/jpeg","width":10,"height":10}]'::jsonb)$q$, rq));
  perform pg_temp.check('К1.2 медиа — OPN07', got = 'OPN07', got);
  got := pg_temp.code_of(format(
    $q$select public.send_voice_message(%L, '{"url":"https://cdn.test/v.m4a","mime_type":"audio/mp4","duration_ms":1000}'::jsonb)$q$, rq));
  perform pg_temp.check('К1.2 голосовое — OPN07', got = 'OPN07', got);
  got := pg_temp.code_of(format(
    $q$select public.forward_messages(%L, %L, array[%L]::uuid[])$q$, rq, grp_h, msg_h_v));
  perform pg_temp.check('К1.2 пересылка — OPN07', got = 'OPN07', got);
  got := pg_temp.code_of(format($q$select public.start_call(%L)$q$, rq));
  perform pg_temp.check('К1.2 звонок — OPN07', got = 'OPN07', got);
  got := pg_temp.code_of(format(
    $q$select public.edit_message(%L, 'с фото', '[{"url":"https://cdn.test/p.jpg","mime_type":"image/jpeg","width":10,"height":10}]'::jsonb, null)$q$, msg_rq));
  perform pg_temp.check('К1.2 правка в медиа — отказ', got <> 'ok', got);

  -- Посторонний не видит заявку ничем.
  perform pg_temp.act_as(v);
  perform pg_temp.check('К1.3 V: chats', not exists (select 1 from public.chats where id = rq));
  perform pg_temp.check('К1.3 V: messages', not exists (select 1 from public.messages where chat_id = rq));
  perform pg_temp.check('К1.3 V: message_rows', not exists (select 1 from public.message_rows where chat_id = rq));
  perform pg_temp.check('К1.3 V: «ещё не принял»', not exists (select 1 from public.chat_waiting_invitees where chat_id = rq));
  perform pg_temp.check('К1.3 V: участники', not exists (select 1 from public.chat_people(array[rq])));
  perform pg_temp.check('К1.3 V: чаты A', not exists (
    select 1 from public.chats c join public.chat_members cm on cm.chat_id = c.id
    where cm.user_id = a and c.id = rq));
  perform pg_temp.check('К1.3 V: поиск сообщений', not exists (
    select 1 from public.search_messages('заявка') s where s.chat_id = rq));
  perform pg_temp.check('К1.3 V: поиск внутри чата', not exists (
    select 1 from public.search_chat_messages(rq, 'заявка'))
      and public.count_chat_search(rq, 'заявка') = 0);
  perform pg_temp.check('К1.3 V: топик chat:<id> не читается', not public.realtime_chat_readable('chat:' || rq));
  perform set_config('realtime.topic', 'chat:' || rq, true);
  perform pg_temp.check('К1.3 V: рассылки заявки не отдаются', not exists (
    select 1 from realtime.messages where topic = 'chat:' || rq));
  perform set_config('realtime.topic', '', true);
  got := pg_temp.code_of(format($q$select public.subscribe_to_chat(%L)$q$, rq));
  perform pg_temp.check('К1.3 V: подписка — не найдено', got = 'P0002', got);
  got := pg_temp.code_of(format($q$select public.set_reaction('message', %L, %L)$q$, msg_rq, emoji));
  perform pg_temp.check('К1.3 V: реакция — не найдено', got = 'P0002', got);
  got := pg_temp.code_of(format($q$select public.send_comment(%L, 'коммент')$q$, msg_rq));
  perform pg_temp.check('К1.3 V: комментарий — не найдено', got = 'P0002', got);

  -- Получатель видит, просмотр не засчитывается.
  perform pg_temp.act_as(b);
  perform pg_temp.check('К1.4 B видит чат и текст', exists (select 1 from public.chats where id = rq)
    and (select text from public.message_rows where chat_id = rq) = 'Привет, это заявка');
  perform public.record_message_views(rq, array[msg_rq], gen_random_uuid());
  perform pg_temp.as_owner();
  perform pg_temp.check('К1.4 открытие заявки — без просмотров и прочтения',
    (select views_count = 0 and read_at is null from public.messages where id = msg_rq));

  -- Принятие.
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(rq);
  got := pg_temp.code_of(format(
    $q$insert into public.messages (chat_id, author_id, kind, text) values (%L, %L, 'text', 'ответ Бориса')$q$, rq, b));
  perform pg_temp.check('К1.5 после принятия B пишет', got = 'ok', got);
  perform pg_temp.act_as(a);
  got := pg_temp.code_of(format(
    $q$insert into public.messages (chat_id, author_id, kind, text) values (%L, %L, 'text', 'второе от Ани')$q$, rq, a));
  perform pg_temp.check('К1.5 после принятия A пишет', got = 'ok', got);
  perform pg_temp.act_as(v);
  perform pg_temp.check('К1.5 V видит переписку с текстом заявки',
    (select count(*) from public.message_rows where chat_id = rq) = 3
      and exists (select 1 from public.message_rows where chat_id = rq and text = 'Привет, это заявка'));

  -- Отказ: D → B.
  perform pg_temp.act_as(d);
  rq_d := (public.create_chat(array[b], null, null, 'Дина пишет') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.decline_chat_invite(rq_d);
  perform pg_temp.act_as(d);
  perform pg_temp.check('К1.6 D: отказ не виден — B по-прежнему «ещё не принял»',
    exists (select 1 from public.chat_waiting_invitees where chat_id = rq_d and user_id = b)
      and not exists (select 1 from public.chat_invites where chat_id = rq_d));
  perform pg_temp.check('К1.6 D: заявка остаётся невидимой посторонним', (
    select request_pending from public.chats where id = rq_d));
  got := pg_temp.code_of(format($q$select public.create_chat(array[%L]::uuid[])$q$, b));
  perform pg_temp.check('К1.6 повтор при живой заявке — OPN01', got = 'OPN01', got);
  perform public.delete_direct_chat(rq_d);
  got := pg_temp.code_of(format($q$select public.create_chat(array[%L]::uuid[])$q$, b));
  perform pg_temp.check('К1.6 повтор в течение 30 дней — OPN09', got = 'OPN09', got);
  perform pg_temp.as_owner();
  update public.dialogue_requests set closed_at = now() - interval '31 days' where requester_id = d;
  perform pg_temp.act_as(d);
  res := public.create_chat(array[b]);
  perform pg_temp.check('К1.6 через 30 дней — можно', res ->> 'outcome' = 'request_needed', res::text);
  rq_d := (public.create_chat(array[b], null, null, 'Дина снова') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.decline_chat_invite(rq_d);
  perform pg_temp.as_owner();
  update public.dialogue_requests set closed_at = now() - interval '400 days' where requester_id = d;
  perform pg_temp.act_as(d);
  perform public.delete_direct_chat(rq_d);
  got := pg_temp.code_of(format($q$select public.create_chat(array[%L]::uuid[])$q$, b));
  perform pg_temp.check('К1.6 после второго отказа — никогда', got = 'OPN09', got);

  -- Отмена своей заявки тоже считается.
  perform pg_temp.act_as(e);
  rq_v := (public.create_chat(array[b], null, null, 'Егор пишет') ->> 'chat_id')::uuid;
  perform public.delete_direct_chat(rq_v);
  got := pg_temp.code_of(format($q$select public.create_chat(array[%L]::uuid[], null, null, 'ещё раз')$q$, b));
  perform pg_temp.check('К1.7 удалить и создать заново — OPN09', got = 'OPN09', got);

  -- Лимит частоты — по устройству, порог из конфига без миграции.
  perform pg_temp.as_owner();
  insert into public.safety_config (version, params) values (1000, '{"contact_requests_per_day": 2}');
  perform pg_temp.act_as(a2);
  res := public.create_chat(array[v], null, null, 'A2 пишет Вере');
  perform pg_temp.check('К1.7 вторая заявка устройства за сутки — можно', res ->> 'outcome' = 'created', res::text);
  got := pg_temp.code_of(format($q$select public.create_chat(array[%L]::uuid[], null, null, 'A2 пишет Дине')$q$, d));
  perform pg_temp.check('К1.7/К4.4 третья заявка с того же устройства — OPN10', got = 'OPN10', got);
  perform pg_temp.as_owner();
  delete from public.safety_config where version = 1000;

  -- Друг пишет сразу.
  perform pg_temp.act_as(f);
  res := public.create_chat(array[b]);
  fb := (res ->> 'chat_id')::uuid;
  perform pg_temp.as_owner();
  perform pg_temp.check('К1.8 друг — сразу диалог, оба участники, без заявки',
    res ->> 'outcome' = 'created'
      and not (select request_pending from public.chats where id = fb)
      and (select count(*) from public.chat_members where chat_id = fb) = 2
      and not exists (select 1 from public.chat_invites where chat_id = fb));
  perform pg_temp.act_as(b);
  got := pg_temp.code_of(format(
    $q$select public.send_voice_message(%L, '{"url":"https://cdn.test/v.m4a","mime_type":"audio/mp4","duration_ms":1000,"size_bytes":10}'::jsonb)$q$, fb));
  perform pg_temp.check('К1.8 в диалоге с другом голосовое можно', got = 'ok', got);

  -- Группа и встречная заявка — как раньше.
  perform pg_temp.act_as(a);
  res := public.create_chat(array[b, d], 'Блк группа');
  perform pg_temp.check('К1.9 группа создаётся заявками', res ->> 'outcome' = 'created', res::text);
  perform pg_temp.act_as(b);
  res := public.create_chat(array[a, d]);
  perform pg_temp.check('К1.9 встречная — открывает существующий', res ->> 'outcome' = 'incoming_invite', res::text);

  -- ========================================================= 2. Блокировка
  -- До блокировки: A и B друзья, A комментирует и реагирует на сообщение V в
  -- H, B — тоже комментарий, A реагирует на комментарий B.
  perform pg_temp.as_owner();
  insert into public.friendships (requester_id, addressee_id, status, accepted_at) values (a, b, 'accepted', now());

  perform pg_temp.act_as(a);
  com_a := public.send_comment(msg_h_v, 'Аня под Верой');
  perform public.set_reaction('message', msg_h_v, emoji);
  perform pg_temp.act_as(b);
  com_b := public.send_comment(msg_h_v, 'Борис под Верой');

  perform public.block_user(a);

  perform pg_temp.as_owner();
  perform pg_temp.check('К2.3 дружба разорвана', not public.are_friends(a, b));
  perform pg_temp.check('К2.3 висящая заявка A в группу для B отклонена',
    not exists (select 1 from public.chat_invites where inviter_id = a and invitee_id = b and status = 'pending'));

  perform pg_temp.act_as(a);
  perform pg_temp.check('К2.1 A не находит B', not exists (select 1 from public.search_people('blkboris')));
  perform pg_temp.check('К2.1 A не находит B в общем поиске', not exists (
    select 1 from public.search_entities('blkboris') s where s.peer_id = b and s.section = 'global'));
  perform pg_temp.check('К2.1 профиль B не читается', not exists (select 1 from public.profiles where id = b));
  select (online, last_seen_at)::text into got from public.activity_statuses(array[b]);
  perform pg_temp.check('К2.1 статус B — как неизвестный', got = '(f,)', got);

  got := pg_temp.code_of(format($q$select public.create_chat(array[%L]::uuid[])$q$, b));
  perform pg_temp.check('К2.2 заявка на диалог — OPN08', got = 'OPN08', got);
  got := pg_temp.code_of(format($q$select public.invite_to_chat(%L, array[%L]::uuid[])$q$, grp_a, b));
  perform pg_temp.check('К2.2 приглашение в группу — OPN08', got = 'OPN08', got);
  got := pg_temp.code_of(format($q$select public.send_friend_request(%L)$q$, b));
  perform pg_temp.check('К2.2 заявка в друзья — OPN08', got = 'OPN08', got);
  got := pg_temp.code_of(format($q$select public.send_comment(%L, 'Аня Борису')$q$, msg_h_b));
  perform pg_temp.check('К2.2 комментарий к сообщению B — OPN08', got = 'OPN08', got);
  got := pg_temp.code_of(format($q$select public.set_reaction('message', %L, %L)$q$, msg_h_b, emoji));
  perform pg_temp.check('К2.2 реакция на сообщение B — OPN08', got = 'OPN08', got);
  got := pg_temp.code_of(format($q$select public.set_reaction('comment', %L, %L)$q$, com_b, emoji));
  perform pg_temp.check('К2.2 реакция на комментарий B — OPN08', got = 'OPN08', got);
  got := pg_temp.code_of(format($q$select public.send_comment(%L, 'ответ', '[]'::jsonb, null, %L)$q$, msg_h_v, com_b));
  perform pg_temp.check('К2.2 ответ в ветке B — OPN08', got = 'OPN08', got);
  got := pg_temp.code_of(format($q$select public.send_comment(%L, 'к сообщению в G')$q$, msg_g_b));
  perform pg_temp.check('К2.2 комментарий к скрытому сообщению B в G — отказ', got <> 'ok', got);

  -- Общая личка: никто не пишет и не звонит, история видна.
  got := pg_temp.code_of(format(
    $q$insert into public.messages (chat_id, author_id, kind, text) values (%L, %L, 'text', 'A в личку')$q$, rq, a));
  perform pg_temp.check('К2.4 A не пишет в общую личку', got = 'OPN08', got);
  got := pg_temp.code_of(format($q$select public.start_call(%L)$q$, rq));
  perform pg_temp.check('К2.4 A не звонит', got = 'OPN08', got);
  perform pg_temp.check('К2.4 A видит историю лички',
    (select count(*) from public.message_rows where chat_id = rq and not hidden and text is not null) = 3);
  perform pg_temp.act_as(b);
  got := pg_temp.code_of(format(
    $q$insert into public.messages (chat_id, author_id, kind, text) values (%L, %L, 'text', 'B в личку')$q$, rq, b));
  perform pg_temp.check('К2.4 B не пишет в общую личку', got = 'OPN08', got);
  perform pg_temp.check('К2.4 B видит историю лички',
    (select count(*) from public.message_rows where chat_id = rq) = 3);

  -- G: заглушка без дыр в номерах.
  perform pg_temp.act_as(a);
  select * into hidden_row from public.message_rows where id = msg_g_b;
  perform pg_temp.check('К2.5 сообщение B в G — заглушка без текста',
    hidden_row.hidden and hidden_row.text is null and hidden_row.kind = 'text');
  perform pg_temp.check('К2.5 прямой запрос не отдаёт сообщение B', not exists (
    select 1 from public.messages where id = msg_g_b));
  perform pg_temp.check('К2.5 страница G целиком — три строки', (
    select count(*) from public.message_rows where chat_id = grp_g) = 3);
  perform pg_temp.as_owner();
  insert into public.messages (chat_id, author_id, kind, text) values (grp_g, b, 'text', 'Борис последним');
  -- Превью пишет отложенный триггер рассылки — на коммите, которого тут нет.
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.act_as(a);
  select public.last_message_preview(c) into got from public.chat_rows c where c.id = grp_g;
  perform pg_temp.check('К2.5 превью G для A — заглушка', got = 'Сообщение скрыто', got);
  perform pg_temp.act_as(v);
  select public.last_message_preview(c) into got from public.chat_rows c where c.id = grp_g;
  perform pg_temp.check('К2.5 превью G для V — текст', got = 'Борис последним', got);
  perform pg_temp.act_as(a);

  -- H: оба видят друг друга.
  perform pg_temp.check('К2.6 A видит сообщение B в H', (
    select not hidden and text = 'Борис в H' from public.message_rows where id = msg_h_b));

  -- B не видит комментариев и реакций A.
  perform pg_temp.act_as(b);
  perform pg_temp.check('К2.7 B не видит комментарий A', not exists (select 1 from public.comments where id = com_a)
    and not exists (select 1 from public.list_comment_thread_roots(msg_h_v) r where r.id = com_a));
  perform pg_temp.check('К2.7 B не видит реакцию A', not exists (
    select 1 from public.reactions where target_id = msg_h_v and user_id = a));
  perform pg_temp.check('К2.7 B видит свои и чужие (V) — свой комментарий на месте',
    exists (select 1 from public.comments where id = com_b));

  -- Устройство.
  perform pg_temp.act_as(a2);
  got := pg_temp.code_of(format($q$select public.create_chat(array[%L]::uuid[])$q$, b));
  perform pg_temp.check('К2.8 A2 с того же устройства — OPN08', got = 'OPN08', got);
  perform pg_temp.check('К2.8 A2 не видит профиль B', not exists (select 1 from public.profiles where id = b));
  perform pg_temp.as_owner();
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (a3, 'p3a3@test.local', '{"full_name":"Блк Аня Три"}', 'authenticated', 'authenticated');
  insert into public.account_installations (user_id, installation_id) values (a3, device);
  perform pg_temp.act_as(a3);
  got := pg_temp.code_of(format($q$select public.send_friend_request(%L)$q$, b));
  perform pg_temp.check('К2.8 новый аккаунт с того же устройства — OPN08', got = 'OPN08', got);

  -- Список заблокированных.
  perform pg_temp.act_as(b);
  perform pg_temp.check('К2.10 «Заблокированные» показывают A', exists (
    select 1 from public.list_blocked_users() l where l.user_id = a));
  perform pg_temp.act_as(v);
  perform pg_temp.check('К2.10 чужие блокировки не читаются', not exists (select 1 from public.blocks));

  -- Разблокировка.
  perform pg_temp.act_as(b);
  perform public.unblock_user(a);
  perform pg_temp.act_as(a);
  perform pg_temp.check('К2.9 профиль B снова читается', exists (select 1 from public.profiles where id = b));
  perform pg_temp.check('К2.9 A снова находит B', exists (select 1 from public.search_people('blkboris')));
  got := pg_temp.code_of(format($q$select public.send_comment(%L, 'снова можно')$q$, msg_h_b));
  perform pg_temp.check('К2.9 комментарии снова работают', got = 'ok', got);
  got := pg_temp.code_of(format($q$select public.send_friend_request(%L)$q$, b));
  perform pg_temp.check('К2.9 заявка в друзья снова работает, дружба не восстановлена',
    got = 'ok' and public.friendship_status(b) = 'outgoing', got);

  -- ============================================================= 3. Жалобы
  perform pg_temp.act_as(v);
  rq_v := (public.create_chat(array[b], null, null, 'Вера Борису') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.report_user(v, 'harassment', rq_v, 'неприятно');
  perform public.report_user(v, 'harassment', rq_v, 'ещё раз');
  perform public.report_user(v, 'spam');
  got := pg_temp.code_of('select count(*) from public.reports');
  perform pg_temp.check('К3.1 reports не читаются пользователем', got = '42501', got);
  perform pg_temp.as_owner();
  perform pg_temp.check('К3.1/К3.2 жалоба на заявку и на профиль, без дублей', (
    select count(*) from public.reports where reporter_id = b and target_user_id = v) = 2);
  perform pg_temp.act_as(b);
  perform public.report_user(v, 'spam', null, null, true);
  perform pg_temp.as_owner();
  perform pg_temp.check('К3.3 «Пожаловаться и заблокировать»', (
    select count(*) from public.reports where reporter_id = b and target_user_id = v) = 2
      and exists (select 1 from public.blocks where blocker_id = b and blocked_id = v));

  -- ===================================================== 4. Автоограничения
  for i in 1 .. 4 loop
    perform pg_temp.act_as(ks[i]);
    perform public.block_user(t);
  end loop;

  perform pg_temp.as_owner();
  perform pg_temp.check('К4.3 меньше K — ограничений нет', not public.contact_restricted(t));
  perform pg_temp.act_as(ks[5]);
  perform public.report_user(t, 'spam');
  perform pg_temp.as_owner();
  perform pg_temp.check('К4.1 K разных людей (блокировки и жалоба) — ограничен', public.contact_restricted(t));

  insert into public.chats (kind, created_by, owner_id, title)
  values ('group', t, t, 'Блк T') returning id into grp_t;
  insert into public.chat_members (chat_id, user_id) values (grp_t, t);

  perform pg_temp.act_as(t);
  got := pg_temp.code_of(format($q$select public.create_chat(array[%L]::uuid[])$q$, u));
  perform pg_temp.check('К4.1 заявка не-другу — OPN11', got = 'OPN11', got);
  got := pg_temp.code_of(format($q$select public.send_friend_request(%L)$q$, u));
  perform pg_temp.check('К4.1 заявка в друзья — OPN11', got = 'OPN11', got);
  got := pg_temp.code_of(format($q$select public.invite_to_chat(%L, array[%L]::uuid[])$q$, grp_t, u));
  perform pg_temp.check('К4.1 приглашение в группу не-друга — OPN11', got = 'OPN11', got);
  perform pg_temp.check('К4.1 поиск людей — только знакомые', not exists (
    select 1 from public.search_people('Блк Ульяна')));
  res := public.create_chat(array[q]);
  perform pg_temp.check('К4.1 другу пишет как раньше', res ->> 'outcome' = 'created', res::text);
  got := pg_temp.code_of(format($q$select public.invite_to_chat(%L, array[%L]::uuid[])$q$, grp_t, q));
  perform pg_temp.check('К4.1 друга в группу позвать можно', got = 'ok', got);

  perform pg_temp.as_owner();
  update public.account_restrictions set restricted_until = now() - interval '1 second' where user_id = t;
  perform pg_temp.act_as(t);
  res := public.create_chat(array[u]);
  perform pg_temp.check('К4.2 по истечении срока снято', res ->> 'outcome' = 'request_needed', res::text);

  -- Пять аккаунтов одного телефона — один человек, а не пять.
  perform pg_temp.as_owner();
  delete from public.account_restrictions where user_id = t;
  delete from public.blocks where blocked_id = t;
  delete from public.reports where target_user_id = t;
  insert into public.account_installations (user_id, installation_id)
  select k, '00000000-0000-4000-8000-0000000003ff'::uuid from unnest(ks) k;
  for i in 1 .. 5 loop
    perform pg_temp.act_as(ks[i]);
    perform public.block_user(t);
  end loop;
  perform pg_temp.as_owner();
  perform pg_temp.check('К4.3 пять аккаунтов одного устройства — не K разных людей',
    not public.contact_restricted(t));

  perform pg_temp.as_owner();
  insert into public.safety_config (version, params) values (1000, '{"auto_restrict_actors": 1}');
  perform pg_temp.act_as(q);
  perform public.block_user(u);
  perform pg_temp.as_owner();
  perform pg_temp.check('К4.4 порог из новой строки конфига действует сразу', public.contact_restricted(u));
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
