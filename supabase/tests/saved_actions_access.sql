-- Сохранённые, этап 2: теги, «Посмотреть позже», закрепы, удаление, страницы
-- и проверка пересылки — только своё и только функциями.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/saved_actions_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

-- Файлы фикстур отмечаются очищенными до проверки (как в
-- saved_messages_access.sql): тест не про очистку.
create function public.test_mark_sanitized() returns trigger
language plpgsql security definer set search_path = public as $fixture$
declare
  owner uuid;
begin
  select m.author_id into owner from public.messages m where m.id = new.message_id;

  insert into public.media_objects (bucket, path, owner_id, kind, mime_type, size_bytes)
  select 'chat-media', v.p, owner, v.k, coalesce(new.mime_type, ''), 0
  from (values
    (new.url, case when new.mime_type like 'image/%' then 'photo' else 'video' end),
    (new.poster_url, 'poster')
  ) v(p, k)
  where v.p is not null and owner is not null
  on conflict do nothing;

  return new;
end;
$fixture$;

create trigger attachments_aa_test_sanitized before insert or update of url, poster_url
  on public.attachments for each row execute function public.test_mark_sanitized();

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000018a1', 'ta@test.local', '{"full_name":"Автор A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000018b1', 'tb@test.local', '{"full_name":"Владелец B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000018c1', 'tv@test.local', '{"full_name":"Посторонний V"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000018e1', 'tz@test.local', '{"full_name":"Чужой Z"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, coalesce(ok, false), detail) $$;

create function pg_temp.join(p_chat uuid) returns void language plpgsql as $$
begin
  if not exists (select 1 from public.chat_members where chat_id = p_chat and user_id = auth.uid()) then
    perform public.accept_chat_invite(p_chat);
  end if;
end;
$$;

create function pg_temp.code_of(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'прошло';
exception when others then
  return sqlstate;
end;
$$;

update public.privacy_settings set
  message_activity_metadata_visibility = 'everyone',
  activity_status_visibility = 'everyone',
  account_search_visibility = 'everyone',
  profile_identity_masking = 'everyone',
  dialogue_participant_name_masking = 'everyone',
  avatar_visibility = 'everyone',
  dialogue_media_visibility = 'everyone',
  public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like 't_@test.local');

insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000018a1', '00000000-0000-4000-8000-0000000018b1', 'accepted', now());

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000018a1';
  b uuid := '00000000-0000-4000-8000-0000000018b1';
  v uuid := '00000000-0000-4000-8000-0000000018c1';
  z uuid := '00000000-0000-4000-8000-0000000018e1';
  grp uuid;
  dm uuid;
  m1 uuid;
  m2 uuid;
  m3 uuid;
  album uuid;
  dm_msg uuid;
  c_live uuid;
  c_gone uuid;
  tag1 uuid;
  tag2 uuid;
  s1 uuid;
  s2 uuid;
  s3 uuid;
  s_album uuid;
  s_dm uuid;
  s_cl uuid;
  s_cg uuid;
  s_vis uuid;
  w uuid[];
  ids uuid[];
  page uuid[];
  cur record;
  n int;
  t0 timestamptz := now() - interval '1 day';
begin
  -- ------------------------------------------------------------- подготовка
  perform pg_temp.act_as(a);
  grp := (public.create_chat(array[b], 'Группа') ->> 'chat_id')::uuid;
  dm := (public.create_chat(array[b]) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform pg_temp.join(grp);
  perform pg_temp.join(dm);

  perform pg_temp.act_as(a);
  m1 := public.send_media_message(grp, 'первое', '[]'::jsonb);
  m2 := public.send_media_message(grp, 'второе', '[]'::jsonb);
  m3 := public.send_media_message(grp, 'третье', '[]'::jsonb);
  album := public.send_media_message(grp, 'альбом', jsonb_build_array(
    jsonb_build_object('url', a || '/photo/1.jpg', 'mime_type', 'image/jpeg', 'width', 100, 'height', 80),
    jsonb_build_object('url', a || '/video/2.mp4', 'poster_url', a || '/poster/2.jpg', 'mime_type', 'video/mp4',
      'width', 640, 'height', 360, 'duration_ms', 5000)
  ));
  dm_msg := public.send_media_message(dm, 'в личке', '[]'::jsonb);
  c_live := public.send_comment(m1, 'живой комментарий');
  c_gone := public.send_comment(m1, 'удалят');
  set constraints all immediate;
  set constraints all deferred;

  perform pg_temp.act_as(b);
  tag1 := (select t.id from public.create_saved_tag('Работа') t);
  tag2 := (select t.id from public.create_saved_tag('Дом') t);
  ids := public.save_messages(grp, array[m1, m2, m3]);
  s1 := ids[1];
  s2 := ids[2];
  s3 := ids[3];
  s_album := (public.save_messages(grp, array[album], array[tag1, tag2]))[1];
  s_dm := (public.save_messages(dm, array[dm_msg]))[1];
  ids := public.save_comments(array[c_live, c_gone]);
  s_cl := ids[1];
  s_cg := ids[2];

  -- ================================================ К1.1 — владелец и чужой
  perform public.set_saved_tag(s1, tag1, true);
  perform public.set_saved_tag(s1, tag1, true);
  perform pg_temp.check('тег поставлен, повтор не дублирует, счётчик растёт',
    (select count(*) from public.saved_message_tags where saved_id = s1) = 1
      and (select uses_count from public.saved_tags where id = tag1) = 2);
  perform public.set_saved_tag(s1, tag1, false);
  perform pg_temp.check('тег снят, счётчик уменьшился',
    (select count(*) from public.saved_message_tags where saved_id = s1) = 0
      and (select uses_count from public.saved_tags where id = tag1) = 1);

  perform public.set_saved_watch_later(array[s1], 'later');
  perform pg_temp.check('«Посмотреть позже»: добавлено',
    (select watch_later_at is not null and watch_done_at is null from public.saved_messages where id = s1)
      and (select watch_later_pending from public.saved_summary()) = 1);
  perform public.set_saved_watch_later(array[s1], 'done');
  perform pg_temp.check('«Посмотреть позже»: выполнено, счётчик 0',
    (select watch_done_at is not null from public.saved_messages where id = s1)
      and (select watch_later_pending from public.saved_summary()) = 0);
  perform public.set_saved_watch_later(array[s1], 'undone');
  perform pg_temp.check('«Посмотреть позже»: отметка снята',
    (select watch_later_at is not null and watch_done_at is null from public.saved_messages where id = s1));
  perform public.set_saved_watch_later(array[s1], 'off');
  perform pg_temp.check('«Посмотреть позже»: убрано из вкладки, запись осталась',
    (select watch_later_at is null and watch_done_at is null from public.saved_messages where id = s1));
  perform pg_temp.check('выполнить не добавленное — ничего',
    pg_temp.code_of(format($q$select public.set_saved_watch_later(array[%L]::uuid[], 'done')$q$, s1)) = 'прошло'
      and (select watch_done_at is null from public.saved_messages where id = s1));
  perform pg_temp.check('неизвестное состояние отвергается',
    pg_temp.code_of(format($q$select public.set_saved_watch_later(array[%L]::uuid[], 'x')$q$, s1)) = '22023');

  perform public.restore_saved_watch_later(s1, t0, t0 + interval '1 hour');
  perform pg_temp.check('«Вернуть»: прежние время и отметка',
    (select watch_later_at = t0 and watch_done_at = t0 + interval '1 hour' from public.saved_messages where id = s1));
  perform pg_temp.check('«Вернуть»: время из будущего отвергается',
    pg_temp.code_of(format($q$select public.restore_saved_watch_later(%L, now() + interval '1 hour', null)$q$, s1)) = '22023');
  perform public.restore_saved_watch_later(s1, now() + interval '3 second', now() - interval '1 minute');
  perform pg_temp.check('«Вернуть»: спешащие часы клиента поджаты к серверным',
    (select watch_later_at = now() and watch_done_at = now() from public.saved_messages where id = s1));
  perform public.set_saved_watch_later(array[s1], 'off');

  perform public.set_saved_pinned(array[s2], true);
  perform public.set_saved_pinned(array[s1], true);
  perform pg_temp.check('закрепы по времени закрепления',
    (select array_agg(id) from public.list_saved_pins()) = array[s2, s1]);
  perform public.set_saved_pinned(array[s2], false);
  perform pg_temp.check('открепление',
    (select array_agg(id) from public.list_saved_pins()) = array[s1]);
  perform public.set_saved_pinned(array[s_album], true);
  perform pg_temp.check('закреп с фото: миниатюра — первое фото',
    (select thumbnail_url = a || '/photo/1.jpg' from public.list_saved_pins() where id = s_album));

  -- Чужой Z ни одним вызовом не меняет записи B.
  perform pg_temp.act_as(z);
  perform pg_temp.check('чужой: тег — отказ',
    pg_temp.code_of(format('select public.set_saved_tag(%L, %L, true)', s2, tag1)) = 'P0002');
  perform pg_temp.check('чужой: «Посмотреть позже» — отказ',
    pg_temp.code_of(format($q$select public.set_saved_watch_later(array[%L]::uuid[], 'later')$q$, s2)) = 'P0002');
  perform pg_temp.check('чужой: «Вернуть» — отказ',
    pg_temp.code_of(format($q$select public.restore_saved_watch_later(%L, now(), null)$q$, s2)) = 'P0002');
  perform pg_temp.check('чужой: закреп — отказ',
    pg_temp.code_of(format('select public.set_saved_pinned(array[%L]::uuid[], true)', s2)) = 'P0002');
  perform pg_temp.check('чужой: удаление — отказ',
    pg_temp.code_of(format('select public.delete_saved_messages(array[%L]::uuid[])', s2)) = 'P0002');
  perform pg_temp.check('чужой: проверка пересылки — отказ',
    pg_temp.code_of(format('select public.saved_forwardable(array[%L]::uuid[])', s2)) = 'P0002');
  perform pg_temp.check('чужой: закрепов и страниц нет',
    (select count(*) from public.list_saved_pins()) = 0
      and (select count(*) from public.list_saved_watch_later()) = 0
      and (select count(*) from public.list_saved_messages(null, 30, 0)) = 0);

  perform pg_temp.act_as(b);
  perform pg_temp.check('после чужих вызовов у B всё на месте',
    (select count(*) from public.saved_messages where owner_id = b) = 7
      and (select pinned_at is null from public.saved_messages where id = s2)
      and (select watch_later_at is null from public.saved_messages where id = s2));
  perform pg_temp.check('несуществующий тег — отказ',
    pg_temp.code_of(format('select public.set_saved_tag(%L, %L, true)', s2, gen_random_uuid())) = 'P0002');

  perform pg_temp.check('прямая правка закрепа клиентом отказана',
    pg_temp.code_of($q$update public.saved_messages set pinned_at = now()$q$) = '42501');
  perform pg_temp.check('прямая правка «Посмотреть позже» клиентом отказана',
    pg_temp.code_of($q$update public.saved_messages set watch_later_at = now()$q$) = '42501');
  perform pg_temp.check('прямое удаление клиентом отказано',
    pg_temp.code_of($q$delete from public.saved_messages$q$) = '42501');
  perform pg_temp.check('прямое снятие тега клиентом отказано',
    pg_temp.code_of($q$delete from public.saved_message_tags$q$) = '42501');

  -- ========================================= К1.2 — удаление уносит связи
  perform pg_temp.check('до удаления: вложения и теги у альбома',
    (select count(*) from public.saved_message_attachments where saved_id = s_album) = 2
      and (select uses_count from public.saved_tags where id = tag2) = 1);
  perform public.set_saved_watch_later(array[s_album], 'later');
  n := public.delete_saved_messages(array[s_album]);
  perform pg_temp.check('удалена одна запись',
    n = 1 and not exists (select 1 from public.saved_messages where id = s_album));
  perform pg_temp.check('вложения и связи с тегами удалены',
    (select count(*) from public.saved_message_attachments where saved_id = s_album) = 0
      and (select count(*) from public.saved_message_tags where saved_id = s_album) = 0);
  perform pg_temp.check('счётчики тегов уменьшились',
    (select uses_count from public.saved_tags where id = tag1) = 0
      and (select uses_count from public.saved_tags where id = tag2) = 0);
  perform pg_temp.check('удалённое ушло из закрепов и «Посмотреть позже»',
    not exists (select 1 from public.list_saved_pins() where id = s_album)
      and (select watch_later_pending from public.saved_summary()) = 0);
  perform pg_temp.check('повторное удаление — отказ',
    pg_temp.code_of(format('select public.delete_saved_messages(array[%L]::uuid[])', s_album)) = 'P0002');

  -- ================================ К1.3 — порядок и курсор «Посмотреть позже»
  -- Одна транзакция — один now(): времена расставляются «Вернуть».
  perform public.restore_saved_watch_later(s1, t0 + interval '1 minute', null);
  perform public.restore_saved_watch_later(s2, t0 + interval '3 minute', null);
  perform public.restore_saved_watch_later(s3, t0 + interval '2 minute', t0 + interval '10 minute');
  perform public.restore_saved_watch_later(s_dm, t0 + interval '4 minute', t0 + interval '20 minute');
  perform public.restore_saved_watch_later(s_cl, t0 + interval '3 minute', null);
  perform public.restore_saved_watch_later(s_cg, t0, t0 + interval '10 minute');
  -- Активные: s2 и s_cl в одно время (по seq: s_cl новее), затем s1;
  -- выполненные: s_dm (20 мин), затем s_cg и s3 (10 мин, по seq: s_cg новее).
  w := array[s_cl, s2, s1, s_dm, s_cg, s3];
  perform pg_temp.check('порядок: активные новыми вперёд, выполненные ниже, последнее отмеченное первым',
    (select array_agg(x.id) from public.list_saved_watch_later() x) = w,
    (select string_agg(x.text, ' | ') from public.list_saved_watch_later() x));

  ids := '{}';
  page := null;
  for n in 1 .. 10 loop
    if n = 1 then
      select array_agg(x.id) into page from public.list_saved_watch_later(null, null, null, 2) x;
    else
      select (s.watch_done_at is not null) as done, coalesce(s.watch_done_at, s.watch_later_at) as at, s.seq
      into cur from public.saved_messages s where s.id = ids[cardinality(ids)];
      select array_agg(x.id) into page from public.list_saved_watch_later(cur.done, cur.at, cur.seq, 2) x;
    end if;

    exit when page is null;
    ids := ids || page;
  end loop;
  perform pg_temp.check('курсор по две: без потерь и дублей, тот же порядок',
    ids = w, array_to_string(ids, ','));

  perform pg_temp.check('«Все»: после seq — ближайшие более новые, новыми вперёд',
    (select array_agg(x.id) from public.list_saved_messages(null, 2, (select seq from public.saved_messages where id = s1)) x)
      = array[s3, s2]);
  perform pg_temp.check('«Все»: до seq включительно — окно вокруг записи',
    (select array_agg(x.id) from public.list_saved_messages((select seq from public.saved_messages where id = s2) + 1, 2) x)
      = array[s2, s1]);
  perform pg_temp.check('«Все»: строка несёт закреп',
    (select x.pinned_at is not null from public.list_saved_messages() x where x.id = s1));

  -- ========================================= К1.4 — что можно переслать
  perform pg_temp.act_as(a);
  perform public.delete_messages(array[m2]);
  perform public.delete_comment(c_gone);
  perform public.delete_direct_chat(dm);

  perform pg_temp.act_as(b);
  perform pg_temp.check('живой оригинал: чат и сообщение',
    (select x.live and x.chat_id = grp and x.message_id = m1 and x.comment_id is null
     from public.saved_forwardable(array[s1]) x));
  perform pg_temp.check('удалённый оригинал — нельзя',
    (select not x.live and x.chat_id is null and x.message_id is null from public.saved_forwardable(array[s2]) x));
  perform pg_temp.check('удалённый чат — нельзя',
    (select not x.live from public.saved_forwardable(array[s_dm]) x));
  perform pg_temp.check('живой комментарий: id комментария',
    (select x.live and x.comment_id = c_live and x.message_id is null from public.saved_forwardable(array[s_cl]) x));
  perform pg_temp.check('удалённый комментарий — нельзя',
    (select not x.live from public.saved_forwardable(array[s_cg]) x));
  perform pg_temp.check('пачка: по строке на запись, по порядку',
    (select array_agg(x.saved_id) from public.saved_forwardable(array[s3, s1, s2]) x) = array[s1, s2, s3]);

  -- Блокировка автором: посторонний V сохранил, автор A его заблокировал.
  perform pg_temp.act_as(v);
  s_vis := (public.save_messages(grp, array[m3]))[1];
  perform pg_temp.check('посторонний: живой оригинал можно',
    (select x.live from public.saved_forwardable(array[s_vis]) x));
  perform pg_temp.act_as(a);
  perform public.block_user(v);
  perform pg_temp.act_as(v);
  perform pg_temp.check('автор заблокировал — нельзя',
    (select not x.live from public.saved_forwardable(array[s_vis]) x));
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
