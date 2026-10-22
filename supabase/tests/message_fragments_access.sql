-- Фрагменты текста: кто может ставить реакцию и писать комментарий к
-- фрагменту, что закрыто, что функции отвергают, перепривязка при правке и
-- счётчики.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/message_fragments_access.sql
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
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a7', 'fa@test.local', '{"full_name":"Участник A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b7', 'fb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d7', 'fd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

create function pg_temp.say(chat uuid, author uuid, body text) returns uuid
language plpgsql as $$
declare
  id uuid;
begin
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, author, 'text', body)
  returning messages.id into id;
  return id;
end;
$$;

/** Отказ с этим кодом: `sql` выполняется и обязан упасть. */
create function pg_temp.refused(name text, sql text, code text) returns void
language plpgsql as $$
begin
  execute sql;
  perform pg_temp.check(name, false, 'прошло');
exception when others then
  perform pg_temp.check(name, sqlstate = code, sqlstate || ' ' || sqlerrm);
end;
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a7';
  b uuid := '00000000-0000-4000-8000-0000000000b7';
  d uuid := '00000000-0000-4000-8000-0000000000d7';
  chat uuid;
  other_chat uuid;
  ch uuid;
  posts uuid;
  post uuid;
  m uuid;
  gone uuid;
  sys uuid;
  island uuid;
  frag uuid;
  frag2 uuid;
  comment_id uuid;
  reply_id uuid;
  r record;
  s text;
  n int;
  body text := 'это какой-то другой уровень общения';
begin
  -- ------------------------------------------------------------- подготовка
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  other_chat := (public.create_chat(array[d], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);
  perform pg_temp.act_as(d);
  perform public.accept_chat_invite(other_chat);

  perform pg_temp.act_as(a);
  m := pg_temp.say(chat, a, body);
  gone := pg_temp.say(chat, a, 'будет удалено');
  perform public.delete_messages(array[gone]);
  ch := (public.create_channel('Канал фрагментов', 'frag_test_ch', null, null) ->> 'channel_id')::uuid;
  perform pg_temp.as_service();
  select posts_chat_id into posts from public.channels where id = ch;
  perform pg_temp.act_as(a);
  post := pg_temp.say(posts, a, 'пост канала про уровень');

  -- Островок: D пересылает сообщение A в свой чат с A.
  perform pg_temp.act_as(d);
  island := public.forward_messages(other_chat, chat, array[m]);

  perform pg_temp.as_service();
  insert into public.messages (chat_id, author_id, kind, text, system_event)
  values (chat, a, 'system', 'A пригласил(а) B', 'member_invited')
  returning id into sys;

  -- ===================================== посетитель: реакция на диапазон
  perform pg_temp.act_as(d);
  select * into r from public.set_fragment_reaction(m, 4, 27, 'какой-то другой уровень', '🔥');
  frag := r.fragment_id;
  perform pg_temp.check('посетитель ставит реакцию на фрагмент чужого чата',
    frag is not null and r.emoji = '🔥' and r.audience = 'visitor', r::text);

  select reactions_count, comments_count into r from public.messages where id = m;
  perform pg_temp.check('реакция на фрагмент не трогает счётчики сообщения',
    r.reactions_count = 0, r::text);

  select f.visitor_reactions::text || ' ' || f.reactions_count into s
  from public.message_fragments f where f.id = frag;
  perform pg_temp.check('реакция — в ряду посетителей фрагмента', s = '{"🔥": 1} 1', s);

  select count(*) into n from public.message_fragments where message_id = m;
  perform pg_temp.check('посетитель видит фрагмент', n = 1, n::text);

  select my_emoji into s from public.list_message_fragments(m) where id = frag;
  perform pg_temp.check('список фрагментов отдаёт мою реакцию', s = '🔥', s);

  -- Тот же диапазон снова — тот же фрагмент.
  select * into r from public.set_fragment_reaction(m, 4, 27, 'какой-то другой уровень', '👍');
  perform pg_temp.check('тот же диапазон — тот же фрагмент', r.fragment_id = frag, r::text);

  -- ===================================== участник: реакция и комментарий
  perform pg_temp.act_as(b);
  select * into r from public.set_fragment_reaction(m, 4, 27, 'какой-то другой уровень', '❤️');
  frag2 := r.fragment_id;
  perform pg_temp.check('участник ставит реакцию на фрагмент, ряд участников',
    frag2 is not null and frag2 <> frag and r.audience = 'member', r::text);

  comment_id := public.send_comment(m, 'точно сказано', '[]'::jsonb, null, null, jsonb_build_object('id', frag));
  select fragment_id into s from public.comments where id = comment_id;
  perform pg_temp.check('участник пишет комментарий к чужому фрагменту', s = frag::text, s);

end;
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a7';
  b uuid := '00000000-0000-4000-8000-0000000000b7';
  d uuid := '00000000-0000-4000-8000-0000000000d7';
  chat uuid;
  m uuid;
  gone uuid;
  sys uuid;
  island uuid;
  post uuid;
  frag uuid;
  dfrag uuid;
  comment_id uuid;
  reply_id uuid;
  r record;
  s text;
  n int;
begin
  perform pg_temp.as_service();
  select id, chat_id into m, chat from public.messages where text = 'это какой-то другой уровень общения';
  select id into gone from public.messages where chat_id = chat and text = 'будет удалено';
  select id into sys from public.messages where chat_id = chat and kind = 'system' and text = 'A пригласил(а) B';
  select id into island from public.messages where kind = 'forward' and author_id = d;
  select id into post from public.messages where text = 'пост канала про уровень';
  select id into frag from public.message_fragments where message_id = m and author_id = d;

  -- ===================================== посетитель: комментарий диапазоном
  perform pg_temp.act_as(d);
  comment_id := public.send_comment(
    m, 'про общение', '[]'::jsonb, null, null,
    jsonb_build_object('start', 28, 'end', 35, 'text', 'общения')
  );
  select fragment_id into dfrag from public.comments where id = comment_id;
  perform pg_temp.check('посетитель оставляет комментарий новым фрагментом', dfrag is not null and dfrag <> frag, dfrag::text);

  select comments_count into n from public.messages where id = m;
  perform pg_temp.check('комментарий к фрагменту — в счётчике комментариев сообщения', n = 2, n::text);
  select comments_count into n from public.message_fragments where id = dfrag;
  perform pg_temp.check('и в счётчике фрагмента', n = 1, n::text);

  select count(*) into n from public.list_comment_thread_roots(m, null, null, 30, dfrag);
  perform pg_temp.check('корни по фрагменту — только его', n = 1, n::text);
  select count(*) into n from public.list_comment_thread_roots(m);
  perform pg_temp.check('общий список — все корни сообщения', n = 2, n::text);

  -- Голосовой комментарий тем же фрагментом.
  comment_id := public.send_voice_comment(
    m, jsonb_build_object('url', 'https://x/v.m4a', 'mime_type', 'audio/mp4', 'duration_ms', 1000),
    null, null, jsonb_build_object('id', dfrag)
  );
  select comments_count into n from public.message_fragments where id = dfrag;
  perform pg_temp.check('голосовой комментарий к фрагменту', n = 2, n::text);

  -- Ответ в треде фрагмент не принимает, и сам к нему не привязывается.
  reply_id := public.send_comment(m, 'ответ', '[]'::jsonb, null, comment_id);
  select fragment_id::text into s from public.comments where id = reply_id;
  perform pg_temp.check('ответ в треде — обычный ответ без фрагмента', s is null, s);
  perform pg_temp.refused(
    'фрагмент у ответа в треде отвергнут',
    format('select public.send_comment(%L, %L, %L::jsonb, null, %L, %L::jsonb)',
      m, 'ответ', '[]', comment_id, jsonb_build_object('id', dfrag)),
    '22023'
  );

  -- ===================================== пост канала: не подписчик
  select * into r from public.set_fragment_reaction(post, 16, 23, 'уровень', '👍');
  perform pg_temp.check('посторонний ставит реакцию на фрагмент поста', r.audience = 'visitor', r::text);
  comment_id := public.send_comment(post, 'да', '[]'::jsonb, null, null,
    jsonb_build_object('start', 0, 'end', 4, 'text', 'пост'));
  perform pg_temp.check('посторонний комментирует фрагмент поста', comment_id is not null, null);

  -- ===================================== отказы функции
  perform pg_temp.refused('пустой диапазон',
    format('select public.set_fragment_reaction(%L, 3, 3, %L, %L)', m, '', '🔥'), '22023');
  perform pg_temp.refused('диапазон за пределами текста',
    format('select public.set_fragment_reaction(%L, 30, 60, %L, %L)', m, 'ения', '🔥'), '22023');
  perform pg_temp.refused('exact_text не совпадает с текстом',
    format('select public.set_fragment_reaction(%L, 0, 3, %L, %L)', m, 'тот', '🔥'), '22023');
  perform pg_temp.refused('островок фрагментов не принимает',
    format('select public.set_fragment_reaction(%L, 0, 1, %L, %L)', island, 'x', '🔥'), '22023');
  perform pg_temp.refused('системное — тоже',
    format('select public.set_fragment_reaction(%L, 0, 1, %L, %L)', sys, 'A', '🔥'), '22023');
  perform pg_temp.refused('удалённое — не найдено',
    format('select public.set_fragment_reaction(%L, 0, 4, %L, %L)', gone, 'буде', '🔥'), 'P0002');

  -- ===================================== мимо функций
  perform pg_temp.refused('прямая вставка фрагмента отказана',
    format('insert into public.message_fragments (message_id, chat_id, author_id, start_offset, end_offset, exact_text, text_version) values (%L, %L, %L, 0, 3, %L, now())',
      m, chat, d, 'это'),
    '42501');
  perform pg_temp.refused('прямая правка фрагмента отказана',
    format('update public.message_fragments set reactions_count = 99 where id = %L', frag), '42501');
  perform pg_temp.refused('прямое удаление фрагмента отказано',
    format('delete from public.message_fragments where id = %L', frag), '42501');

  -- ===================================== снятие и жизнь фрагмента
  select * into r from public.set_fragment_reaction(m, 4, 27, 'какой-то другой уровень', null);
  perform pg_temp.check('снятие реакции — по моему фрагменту диапазона', r.fragment_id = frag, r::text);
  select count(*) into n from public.message_fragments where id = frag;
  perform pg_temp.check('фрагмент с комментарием жив и без реакций', n = 1, n::text);

  -- B удаляет свой комментарий — у фрагмента не осталось ничего.
  perform pg_temp.act_as(b);
  perform public.delete_comment(
    (select c.id from public.comment_rows c where c.fragment_id = frag and c.author_id = b)
  );
  perform pg_temp.act_as(d);
  select count(*) into n from public.message_fragments where id = frag;
  perform pg_temp.check('фрагмент без реакций и комментариев не виден', n = 0, n::text);
  perform pg_temp.as_service();
  select deleted_at is not null into r from public.message_fragments where id = frag;
  perform pg_temp.check('строка фрагмента не удалена физически', r is not null, r::text);

  -- Снятие без фрагмента ничего не создаёт.
  perform pg_temp.act_as(d);
  select * into r from public.set_fragment_reaction(m, 0, 3, 'это', null);
  perform pg_temp.as_service();
  select count(*) into n from public.message_fragments where message_id = m and start_offset = 0;
  perform pg_temp.check('снятие без фрагмента его не создаёт', n = 0 and r.fragment_id is null, n::text);

  -- Снова тот же диапазон — новый живой фрагмент, реакция на нём.
  perform pg_temp.act_as(d);
  select * into r from public.set_fragment_reaction(m, 4, 27, 'какой-то другой уровень', '🔥');
  frag := r.fragment_id;
  perform pg_temp.check('после смерти — снова живой фрагмент', frag is not null, r::text);

  perform pg_temp.as_service();
  select fragments_count into n from public.messages where id = m;
  perform pg_temp.check('счётчик видимых фрагментов у сообщения', n = 3, n::text);

  -- ===================================== правка: перепривязка
  perform pg_temp.act_as(a);
  perform public.edit_message(m, 'Ну это какой-то другой уровень общения', '[]'::jsonb, null);
  perform pg_temp.as_service();
  select start_offset || '-' || end_offset || ' ' || anchor_state into s from public.message_fragments where id = frag;
  perform pg_temp.check('дописали слово в начало — фрагмент сдвинут', s = '7-30 shifted', s);

  perform pg_temp.act_as(d);
  select my_emoji into s from public.list_message_fragments(m) where start_offset = 7 and author_id = d;
  perform pg_temp.check('выделив те же слова, видно прежнюю реакцию', s = '🔥', s);

  -- Слово «общения» удалили — фрагмент D с комментариями потерян, комментарии живы.
  perform pg_temp.act_as(a);
  perform public.edit_message(m, 'Ну это какой-то другой уровень', '[]'::jsonb, null);
  perform pg_temp.as_service();
  select anchor_state into s from public.message_fragments where id = dfrag;
  perform pg_temp.check('удалённый кусок — фрагмент потерян', s = 'lost', s);
  select count(*) into n from public.comments where fragment_id = dfrag and deleted_at is null;
  perform pg_temp.check('комментарии потерянного фрагмента живы', n = 2, n::text);
  select fragments_count into n from public.messages where id = m;
  perform pg_temp.check('потерянный не считается видимым', n = 2, n::text);

  -- Два одинаковых места без различий в соседях — неоднозначно.
  perform pg_temp.act_as(a);
  perform public.edit_message(m, 'уровень и уровень', '[]'::jsonb, null);
  perform pg_temp.as_service();
  select anchor_state into s from public.message_fragments where message_id = m and author_id = d and id = frag;
  perform pg_temp.check('нет exact_text — потерян', s = 'lost', s);

  perform pg_temp.as_service();
  select prefix_text || '|' || suffix_text into s from public.message_fragments where id = dfrag;
  perform pg_temp.check('потерянный забыл соседний текст', s = '|', s);

  -- ===================================== фрагмент назначает только база
  perform pg_temp.act_as(d);
  perform pg_temp.refused('fragment_id прямой вставкой комментария не пишется',
    format('insert into public.comments (chat_id, message_id, author_id, kind, text, fragment_id) values (%L, %L, %L, %L, %L, %L)',
      chat, m, d, 'text', 'мимо', frag),
    '42501');
  perform pg_temp.refused('пустой фрагмент мимо реакции и комментария не создать',
    format('select public.fragment_from_request(%L, %L::jsonb)', m, '{"start":0,"end":3,"text":"Ну "}'),
    '42501');

  -- ===================================== обычные реакции не тронуты
  perform pg_temp.act_as(d);
  select audience into s from public.set_reaction('message', m, '👍');
  select reactions_count into n from public.messages where id = m;
  perform pg_temp.check('обычная реакция на сообщение работает и считается', n = 1 and s = 'visitor', n::text);

  -- ===================================== удалённое сообщение прячет фрагменты
  select count(*) into n from public.message_fragments where message_id = post;
  perform pg_temp.check('фрагменты живого поста видны', n > 0, n::text);
  perform pg_temp.act_as(a);
  perform public.delete_messages(array[post]);
  perform pg_temp.act_as(d);
  select count(*) into n from public.message_fragments where message_id = post;
  perform pg_temp.check('фрагменты удалённого сообщения не читаются', n = 0, n::text);
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
