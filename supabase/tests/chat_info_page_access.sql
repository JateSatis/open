-- Страница информации о чате: «был(а) в …» пишет только сам человек через
-- `mark_seen`; вкладки медиа, голосовых и общих групп читают через RLS и
-- не показывают удалённое; посторонний видит публичное, но ничего не меняет.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/chat_info_page_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000001a1', 'ia@test.local', '{"full_name":"A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000001b1', 'ib@test.local', '{"full_name":"B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000001c1', 'ic@test.local', '{"full_name":"C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000001d1', 'id@test.local', '{"full_name":"D"}', 'authenticated', 'authenticated');

insert into storage.objects (bucket_id, name) values
  ('media', '00000000-0000-4000-8000-0000000001c1/group-avatar/c1.jpg');

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

create function pg_temp.check(name text, ok boolean, detail text default null) returns void language sql as $$
  insert into results (name, ok, detail) values (name, ok, detail);
$$;

create function pg_temp.flush() returns void language plpgsql as $$
begin
  set constraints all immediate;
  set constraints all deferred;
end;
$$;

-- Тестовые аккаунты рождаются с защитными настройками приватности
-- (20261029100000_privacy_settings.sql). Здесь проверяется не она: время,
-- «в сети» и поиск открыты всем — их скрытие проверяет
-- privacy_activity_search_access.sql.
update public.privacy_settings set
  message_activity_metadata_visibility = 'everyone',
  activity_status_visibility = 'everyone',
  account_search_visibility = 'everyone'
where user_id in (select id from auth.users where email like '%@test.local');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000001a1';
  b uuid := '00000000-0000-4000-8000-0000000001b1';
  c uuid := '00000000-0000-4000-8000-0000000001c1';
  d uuid := '00000000-0000-4000-8000-0000000001d1';
  dm uuid;
  grp uuid;
  album uuid;
  photo uuid;
  voice uuid;
  n int;
  s text;
  t timestamptz;
  summary record;
begin
  -- --------------------------------------------------------------- засев
  perform pg_temp.act_as(a);
  dm := (public.create_chat(array[b], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(dm);
  perform pg_temp.act_as(a);
  grp := (public.create_chat(array[b, d], 'Общая') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(grp);

  perform pg_temp.act_as(a);
  album := public.send_media_message(dm, 'альбом',
    '[{"url":"https://x/1.jpg","mime_type":"image/jpeg","width":100,"height":80},
      {"url":"https://x/2.mp4","poster_url":"https://x/2p.jpg","mime_type":"video/mp4","width":640,"height":360,"duration_ms":38000}]'::jsonb);
  perform pg_temp.flush();
  photo := public.send_media_message(dm, null,
    '[{"url":"https://x/3.jpg","mime_type":"image/jpeg","width":50,"height":50}]'::jsonb);
  perform pg_temp.flush();
  voice := public.send_voice_message(dm, jsonb_build_object(
    'url', 'https://x/v.m4a', 'mime_type', 'audio/mp4', 'duration_ms', 12000, 'size_bytes', 900));
  perform pg_temp.flush();

  -- ---------------------------------------------------------- «был(а) в …»
  perform public.mark_seen();
  select last_seen_at into t from public.activity_statuses(array[a]);
  perform pg_temp.check('mark_seen ставит свою отметку', t is not null);

  select last_seen_at into t from public.activity_statuses(array[b]);
  perform pg_temp.check('mark_seen не трогает чужую', t is null);

  begin
    update public.user_presence set last_seen_at = now() - interval '1 day' where user_id = a;
    perform pg_temp.check('клиент не пишет отметку напрямую', false, 'прошло');
  exception when others then
    perform pg_temp.check('клиент не пишет отметку напрямую', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.act_as(c);
  select count(*) into n from public.activity_statuses(array[a]) where online and last_seen_at is not null;
  perform pg_temp.check('посторонний видит «в сети» при «видно всем»', n = 1);

  -- ----------------------------------------------------------- выборки
  select count(*) into n from public.list_chat_media(dm);
  perform pg_temp.check('посторонний видит медиа чата: 3 вложения', n = 3, n::text);

  select string_agg(url, ',' order by ord) into s
  from (select url, row_number() over () as ord from public.list_chat_media(dm)) q;
  perform pg_temp.check('свежее сверху, внутри альбома — по порядку',
    s = 'https://x/3.jpg,https://x/1.jpg,https://x/2.mp4', s);

  select count(*) into n from public.list_chat_media(dm, null, 1);
  perform pg_temp.check('страница — по сообщениям', n = 1, n::text);

  select count(*) into n
  from public.list_chat_media(dm, (select seq from public.message_rows where id = photo));
  perform pg_temp.check('курсор отдаёт старше себя: альбом целиком', n = 2, n::text);

  select count(*) into n from public.list_chat_voices(dm);
  perform pg_temp.check('голосовые видны постороннему', n = 1, n::text);

  select author_name into s from public.list_chat_voices(dm);
  perform pg_temp.check('у голосового есть автор', s = 'A', s);

  select * into summary from public.chat_info_summary(dm);
  perform pg_temp.check('сводка: 2 фото, 1 видео, 1 голосовое',
    summary.photos = 2 and summary.videos = 1 and summary.voices = 1,
    summary::text);
  perform pg_temp.check('постороннему общих групп не считают', summary.common_groups = 0);

  select count(*) into n from public.list_common_groups(a);
  perform pg_temp.check('у постороннего с A общих групп нет', n = 0, n::text);

  -- ------------------------------------------------- посторонний не меняет
  begin
    perform public.set_chat_avatar(grp,
      'https://proj.supabase.co/storage/v1/object/public/media/00000000-0000-4000-8000-0000000001c1/group-avatar/c1.jpg');
    perform pg_temp.check('посторонний не ставит фото группы', false, 'прошло');
  exception when others then
    perform pg_temp.check('посторонний не ставит фото группы', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.set_chat_username(grp, 'chuzhaya');
    perform pg_temp.check('посторонний не ставит @имя группы', false, 'прошло');
  exception when others then
    perform pg_temp.check('посторонний не ставит @имя группы', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.set_chat_title(grp, 'Захват');
    perform pg_temp.check('посторонний не меняет название', false, 'прошло');
  exception when others then
    perform pg_temp.check('посторонний не меняет название', sqlstate = '42501', sqlerrm);
  end;

  -- ------------------------------------------------------ участники
  perform pg_temp.act_as(a);
  select * into summary from public.chat_info_summary(dm);
  perform pg_temp.check('участнику диалога — одна общая группа', summary.common_groups = 1,
    summary::text);

  select * into summary from public.chat_info_summary(grp);
  perform pg_temp.check('владелец группы — создатель', summary.owner_id = a);

  select title into s from public.list_common_groups(b);
  perform pg_temp.check('общая группа в списке', s = 'Общая', s);

  perform pg_temp.act_as(b);
  begin
    perform public.set_chat_title(grp, 'От участника');
    perform pg_temp.check('не создатель не меняет название', false, 'прошло');
  exception when others then
    perform pg_temp.check('не создатель не меняет название', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.act_as(a);
  perform public.set_chat_title(grp, '  Новое  ');
  select title into s from public.chats where id = grp;
  perform pg_temp.check('создатель меняет название, пробелы срезаны', s = 'Новое', s);

  begin
    perform public.set_chat_title(dm, 'Диалог');
    perform pg_temp.check('у диалога названия нет', false, 'прошло');
  exception when others then
    perform pg_temp.check('у диалога названия нет', sqlstate = '22023', sqlerrm);
  end;

  -- --------------------------------------------------- удалённое пропадает
  perform public.delete_messages(array[photo, voice]);
  perform pg_temp.flush();

  select count(*) into n from public.list_chat_media(dm);
  perform pg_temp.check('удалённое фото пропало из медиа', n = 2, n::text);

  select count(*) into n from public.list_chat_voices(dm);
  perform pg_temp.check('удалённое голосовое пропало', n = 0, n::text);

  select * into summary from public.chat_info_summary(dm);
  perform pg_temp.check('сводка без удалённого', summary.photos = 1 and summary.voices = 0,
    summary::text);
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
