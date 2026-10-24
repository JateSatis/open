-- Сохранённые сообщения: кто что сохраняет, кто видит, что копия не меняется
-- с оригиналом.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/saved_messages_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

-- Файлы фикстур отмечаются очищенными до проверки (как в
-- replies_and_forwards_access.sql): тест не про очистку.
create function public.test_mark_sanitized() returns trigger
language plpgsql security definer set search_path = public as $fixture$
declare
  owner uuid;
begin
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

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000017a1', 'sa@test.local', '{"full_name":"Автор A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000017b1', 'sb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000017c1', 'sv@test.local', '{"full_name":"Посторонний V"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000017d1', 'sh@test.local', '{"full_name":"Скрывающий H"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000017e1', 'sz@test.local', '{"full_name":"Чужой Z"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

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
where user_id in (select id from auth.users where email like 's_@test.local');

-- Время чата скрыто настройкой H — посторонний его не видит.
update public.privacy_settings set message_activity_metadata_visibility = 'nobody'
where user_id = '00000000-0000-4000-8000-0000000017d1';

-- Участники групп дружат: приглашение не-другу — отдельная тема.
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000017a1', '00000000-0000-4000-8000-0000000017b1', 'accepted', now()),
  ('00000000-0000-4000-8000-0000000017a1', '00000000-0000-4000-8000-0000000017d1', 'accepted', now());

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000017a1';
  b uuid := '00000000-0000-4000-8000-0000000017b1';
  v uuid := '00000000-0000-4000-8000-0000000017c1';
  h uuid := '00000000-0000-4000-8000-0000000017d1';
  z uuid := '00000000-0000-4000-8000-0000000017e1';
  video jsonb := '{"url":"https://proj.supabase.co/storage/v1/object/public/media/s1/pops/v.mp4","poster_url":"https://proj.supabase.co/storage/v1/object/public/media/s1/pops/p.jpg","mime_type":"video/mp4","width":720,"height":1280,"duration_ms":5000}';
  pop uuid := gen_random_uuid();
  grp uuid;
  hidden_grp uuid;
  other_grp uuid;
  r jsonb;
  chan uuid;
  posts uuid;
  post uuid;
  m1 uuid;
  m2 uuid;
  m3 uuid;
  album uuid;
  voice uuid;
  sys uuid;
  hm uuid;
  secret uuid;
  island uuid;
  cfwd uuid[];
  c_msg uuid;
  c_pop uuid;
  c_voice uuid;
  tag1 uuid;
  tag2 uuid;
  tag_z uuid;
  saved uuid[];
  one uuid;
  n int;
  s text;
  ok boolean;
begin
  -- ------------------------------------------------------------- подготовка
  perform pg_temp.act_as(a);
  grp := (public.create_chat(array[b], 'Группа') ->> 'chat_id')::uuid;
  hidden_grp := (public.create_chat(array[h], 'Скрытое время') ->> 'chat_id')::uuid;
  other_grp := (public.create_chat(array[b], 'Другая') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform pg_temp.join(grp);
  perform pg_temp.join(other_grp);
  perform pg_temp.act_as(h);
  perform pg_temp.join(hidden_grp);

  perform pg_temp.act_as(a);
  m1 := public.send_media_message(grp, 'первое', '[]'::jsonb);
  m2 := public.send_media_message(grp, 'второе', '[]'::jsonb);
  m3 := public.send_media_message(grp, 'третье', '[]'::jsonb);
  album := public.send_media_message(grp, 'альбом', jsonb_build_array(
    jsonb_build_object('url', a || '/photo/1.jpg', 'mime_type', 'image/jpeg', 'width', 100, 'height', 80),
    jsonb_build_object('url', a || '/video/2.mp4', 'poster_url', a || '/poster/2.jpg', 'mime_type', 'video/mp4',
      'width', 640, 'height', 360, 'duration_ms', 5000)
  ));
  voice := public.send_voice_message(grp, jsonb_build_object(
    'url', a || '/voice/v.m4a', 'mime_type', 'audio/mp4', 'duration_ms', 4200, 'size_bytes', 100,
    'waveform', jsonb_build_array(1, 5, 31, 0)
  ));
  set constraints all immediate;
  set constraints all deferred;

  perform set_config('role', 'postgres', true);
  insert into public.messages (chat_id, author_id, kind, text, system_event)
  values (grp, a, 'system', 'системное', 'member_joined') returning id into sys;
  perform pg_temp.act_as(a);

  island := public.forward_messages(other_grp, grp, array[m1, m2]);

  perform pg_temp.act_as(h);
  hm := public.send_media_message(hidden_grp, 'у H время скрыто', '[]'::jsonb);

  perform pg_temp.act_as(a);
  r := public.create_channel('Канал сохранённых', 'saved_chan_zz');
  chan := (r ->> 'channel_id')::uuid;
  posts := (r ->> 'chat_id')::uuid;
  r := public.publish_pop(chan, pop, video, 'Поп', 'подпись', true, 'пост с попом', null);
  post := (r ->> 'message_id')::uuid;

  perform pg_temp.act_as(v);
  c_msg := public.send_comment(m1, 'комментарий V');
  c_pop := public.send_pop_comment(pop, 'к попу V');
  c_voice := public.send_voice_comment(m1, '{"url":"x","mime_type":"audio/mp4","duration_ms":1000}'::jsonb);
  set constraints all immediate;
  set constraints all deferred;

  perform pg_temp.act_as(b);
  cfwd := public.forward_comments(grp, array[c_msg]);
  perform public.subscribe_to_channel(chan, true);

  -- ==================================================== К1.1 — кто сохраняет
  perform pg_temp.act_as(b);
  tag1 := (select t.id from public.create_saved_tag('Работа') t);
  tag2 := (select t.id from public.create_saved_tag('  Дом ') t);

  perform pg_temp.check('тег: повтор без учёта регистра выбирает существующий',
    (select t.id from public.create_saved_tag('работа') t) = tag1);
  perform pg_temp.check('тег: имя обрезано, цвета по кругу',
    (select name = 'Дом' and color = 1 from public.saved_tags where id = tag2));
  perform pg_temp.check('тег: пустое имя отвергается',
    pg_temp.code_of($q$select public.create_saved_tag('   ')$q$) = '22023');

  saved := public.save_messages(grp, array[m1], array[tag1, tag2], true);
  perform pg_temp.check('участник сохраняет из своего чата',
    (select source_category = 'member' and text = 'первое' and kind = 'text'
       and watch_later_at is not null and watch_done_at is null
     from public.saved_messages where id = saved[1]));
  perform pg_temp.check('теги привязаны, счётчик использований растёт',
    (select count(*) from public.saved_message_tags where saved_id = saved[1]) = 2
      and (select uses_count from public.saved_tags where id = tag1) = 1);

  perform pg_temp.check('подписчик сохраняет пост канала',
    (select source_category = 'channel' and pop_id = pop
     from public.saved_messages where id = (public.save_messages(posts, array[post]))[1]));

  perform pg_temp.act_as(v);
  saved := public.save_messages(grp, array[album]);
  perform pg_temp.check('посторонний сохраняет из чужого чата',
    (select source_category = 'visitor' from public.saved_messages where id = saved[1]));
  perform pg_temp.check('снимок альбома: файлы по порядку',
    (select string_agg(url, ',' order by position) = a || '/photo/1.jpg,' || a || '/video/2.mp4'
     from public.saved_message_attachments where saved_id = saved[1]));
  perform pg_temp.check('файл сохранённого читается владельцем копии',
    public.chat_media_object_readable(a || '/photo/1.jpg'));

  saved := public.save_messages(posts, array[post]);
  perform pg_temp.check('пост с попом: снимок попа',
    (select pop_id = pop and pop_title = 'Поп' and url like '%/v.mp4' and width = 720
     from public.saved_message_attachments where saved_id = saved[1]));

  saved := public.save_messages(grp, array[voice]);
  perform pg_temp.check('голосовое: волна и длительность в снимке',
    (select waveform = array[1, 5, 31, 0]::smallint[] and duration_ms = 4200
     from public.saved_message_attachments where saved_id = saved[1]));

  -- Чужой Z не видит ничего сохранённого B и V.
  perform pg_temp.act_as(z);
  perform pg_temp.check('другой не читает чужие копии',
    (select count(*) from public.saved_messages) = 0
      and (select count(*) from public.list_saved_messages()) = 0);
  perform pg_temp.check('другой не читает чужие теги и связи',
    (select count(*) from public.saved_tags) = 0 and (select count(*) from public.saved_message_tags) = 0);
  perform pg_temp.check('другой не читает чужие вложения',
    (select count(*) from public.saved_message_attachments) = 0);
  perform pg_temp.check('другой не открывает источник чужой копии',
    pg_temp.code_of(format('select public.saved_source(%L)', (select id from public.saved_messages limit 1))) = 'P0002');
  perform pg_temp.check('сводка другого пустая',
    (select watch_later_pending from public.saved_summary()) = 0);

  perform pg_temp.act_as(b);
  perform pg_temp.check('сводка: одно в «Посмотреть позже»',
    (select watch_later_pending from public.saved_summary()) = 1);
  perform pg_temp.check('сырой id автора клиенту не читается',
    pg_temp.code_of('select author_id from public.saved_messages') = '42501');

  -- ================================================ К1.2 — что сохранить нельзя
  perform pg_temp.check('системное не сохраняется',
    pg_temp.code_of(format('select public.save_messages(%L, array[%L]::uuid[])', grp, sys)) = '22023');
  perform pg_temp.check('островок целиком не сохраняется',
    pg_temp.code_of(format('select public.save_messages(%L, array[%L]::uuid[])', other_grp, island)) = '22023');

  perform pg_temp.act_as(z);
  -- Личка-заявка A → Z видна только двоим.
  perform pg_temp.act_as(a);
  secret := (public.create_chat(array[v], null, null, 'заявка V') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(z);
  perform pg_temp.check('из чата, которого не видно, не сохраняется',
    pg_temp.code_of(format('select public.save_messages(%L, array[(select id from public.messages where chat_id = %L limit 1)]::uuid[])',
      secret, secret)) = 'P0002');
  perform pg_temp.check('сообщение не из этого чата отвергается',
    pg_temp.code_of(format('select public.save_messages(%L, array[%L]::uuid[])', other_grp, m3)) = '42501');

  perform pg_temp.act_as(z);
  tag_z := (select t.id from public.create_saved_tag('Чужой') t);
  perform pg_temp.act_as(b);
  perform pg_temp.check('чужой тег не привязать',
    pg_temp.code_of(format('select public.save_messages(%L, array[%L]::uuid[], array[%L]::uuid[])', grp, m2, tag_z)) = '42501');

  perform pg_temp.check('прямая вставка копии отказана',
    pg_temp.code_of(format($q$insert into public.saved_messages (owner_id, source_type, source_category, kind) values (%L, 'message', 'member', 'text')$q$, b)) = '42501');
  perform pg_temp.check('прямая вставка тега отказана',
    pg_temp.code_of(format($q$insert into public.saved_tags (owner_id, name, color) values (%L, 'x', 0)$q$, b)) = '42501');
  perform pg_temp.check('прямая привязка тега отказана',
    pg_temp.code_of(format($q$insert into public.saved_message_tags (saved_id, tag_id, owner_id) select id, %L, %L from public.saved_messages limit 1$q$, tag1, b)) = '42501');
  perform pg_temp.check('правка копии отказана',
    pg_temp.code_of($q$update public.saved_messages set text = 'x'$q$) = '42501');
  perform pg_temp.check('удаление копии клиентом отказано',
    pg_temp.code_of($q$delete from public.saved_messages$q$) = '42501');
  perform pg_temp.check('правка вложения копии отказана',
    pg_temp.code_of($q$update public.saved_message_attachments set url = 'x'$q$) = '42501');

  -- Заблокировавший: его сообщение в чужом мне чате — заглушка, не сохраняется.
  perform pg_temp.act_as(a);
  perform public.block_user(v);
  perform pg_temp.act_as(v);
  perform pg_temp.check('скрытое сообщение заблокировавшего не сохраняется',
    pg_temp.code_of(format('select public.save_messages(%L, array[%L]::uuid[])', grp, m3)) = 'P0002');
  perform pg_temp.check('уже сохранённое после блокировки остаётся',
    (select count(*) from public.saved_messages where source_message_id = album) = 1);
  perform pg_temp.act_as(a);
  perform public.unblock_user(v);

  -- ======================================== К1.3 — копия не меняется с оригиналом
  perform pg_temp.act_as(b);
  one := (public.save_messages(grp, array[m2]))[1];
  perform pg_temp.check('время оригинала, если видно',
    (select original_at = (select created_at from public.message_rows where id = m2)
     from public.saved_messages where id = one));

  perform pg_temp.act_as(a);
  perform public.edit_message(m2, 'второе, исправлено', '[]'::jsonb, null, null);
  perform public.delete_messages(array[m2]);
  perform pg_temp.act_as(b);
  perform pg_temp.check('правка и удаление оригинала копию не меняют',
    (select text = 'второе' and source_message_id = m2 from public.saved_messages where id = one));
  perform pg_temp.check('источник удалён — original_gone, чат открыть можно',
    (select state = 'original_gone' and chat_id = grp from public.saved_source(one)));
  perform pg_temp.check('источник жив — live с номером',
    (select state = 'live' and seq = (select m.seq from public.message_rows m where m.id = m1)
     from public.saved_source((select id from public.saved_messages where source_message_id = m1 limit 1))));

  perform pg_temp.act_as(v);
  one := (public.save_messages(hidden_grp, array[hm]))[1];
  perform pg_temp.check('время скрыто от сохраняющего — null',
    (select original_at is null and text = 'у H время скрыто' from public.saved_messages where id = one));
  perform pg_temp.check('автор — глазами владельца',
    (select author_name = 'Скрывающий H' and author_id = h from public.list_saved_messages() where id = one));

  -- ======================================== К1.4 — комментарии и порядок копий
  perform pg_temp.act_as(b);
  saved := public.save_comments(array[c_msg, c_pop, c_voice]);
  perform pg_temp.check('комментарий к сообщению: источник — его чат и сообщение',
    (select source_type = 'comment' and source_chat_id = grp and comment_message_id = m1
       and source_seq = (select seq from public.message_rows where id = m1) and text = 'комментарий V'
     from public.saved_messages where id = saved[1]));
  perform pg_temp.check('комментарий к попу: чат постов, категория канал',
    (select source_chat_id = posts and comment_pop_id = pop and source_category = 'channel'
     from public.saved_messages where id = saved[2]));
  perform pg_temp.check('голосовой комментарий: вид и файл',
    (select s.kind = 'voice' and a.url = 'x'
     from public.saved_messages s join public.saved_message_attachments a on a.saved_id = s.id
     where s.id = saved[3]));
  perform pg_temp.check('комментарий — источник live',
    (select state = 'live' and comment_id = c_msg and message_id = m1 from public.saved_source(saved[1])));

  saved := public.save_messages(grp, array[cfwd[1]]);
  perform pg_temp.check('пересланный комментарий сохраняется как комментарий',
    (select source_type = 'comment' and source_comment_id = c_msg from public.saved_messages where id = saved[1]));

  saved := public.save_messages(grp, array[m3, m1, album], array[tag1]);
  perform pg_temp.check('несколько — отдельные копии в порядке на экране',
    cardinality(saved) = 3
      and (select array_agg(source_message_id order by seq) from public.saved_messages where id = any (saved))
        = array[m3, m1, album]);
  perform pg_temp.check('тег у каждой копии',
    (select count(*) from public.saved_message_tags where saved_id = any (saved) and tag_id = tag1) = 3);

  saved := public.save_messages(other_grp, array[m1]);
  perform pg_temp.check('облачко островка: источник — чат первоисточника',
    (select source_chat_id = grp from public.saved_messages where id = saved[1]));
  perform pg_temp.check('повторное сохранение — вторая копия',
    (select count(*) from public.saved_messages where source_message_id = m1 and owner_id = b) >= 3);

  perform pg_temp.check('страница: новыми вперёд, курсор по seq',
    (select array_agg(id) from public.list_saved_messages(null, 2))
      = (select array_agg(id order by seq desc) from (select id, seq from public.saved_messages order by seq desc limit 2) x)
      and (select count(*) from public.list_saved_messages(
        (select min(seq) from (select seq from public.saved_messages order by seq desc limit 2) x), 100))
        = (select count(*) from public.saved_messages) - 2);
  perform pg_temp.check('страница: вложения и теги строкой',
    (select jsonb_array_length(attachments) = 2 and tag_ids = array[tag1]
     from public.list_saved_messages() where source_message_id = album and tag_ids <> '{}' limit 1));
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
