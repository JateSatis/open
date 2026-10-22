-- Закреп комментария и пересылка комментариев к попу: кто закрепляет, что
-- закрепляется, один закреп на цель, удаление снимает закреп, пересылка
-- комментария к попу.
--
-- Запуск против облачной базы, ничего не оставляет — всё в транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/comment_pins_access.sql
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
  ('00000000-0000-4000-8000-0000000000c1', 'pa@test.local', '{"full_name":"Автор A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c2', 'pb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c3', 'pd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

-- Вызов закрепа; отдаёт 'прошло' или sqlstate с текстом ошибки.
create function pg_temp.try_pin(target_comment uuid) returns text language plpgsql as $$
begin
  perform public.pin_comment(target_comment);
  return 'прошло';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

create function pg_temp.try_unpin(target uuid) returns text language plpgsql as $$
begin
  perform public.unpin_comment(target);
  return 'прошло';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

create function pg_temp.pinned(target uuid) returns uuid language sql as $$
  select comment_id from public.comment_pins where target_id = target and deleted_at is null
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000c1';
  b uuid := '00000000-0000-4000-8000-0000000000c2';
  d uuid := '00000000-0000-4000-8000-0000000000c3';
  video jsonb := '{"url":"https://proj.supabase.co/storage/v1/object/public/media/c1/pops/v.mp4","poster_url":"https://proj.supabase.co/storage/v1/object/public/media/c1/pops/p.jpg","mime_type":"video/mp4","width":720,"height":1280,"duration_ms":5000}';
  chat uuid;
  dm uuid;
  m uuid;
  m_b uuid;
  r jsonb;
  chan uuid;
  posts uuid;
  post uuid;
  pop uuid := gen_random_uuid();
  c1 uuid;
  c2 uuid;
  c3 uuid;
  reply uuid;
  other uuid;
  pc1 uuid;
  pc2 uuid;
  preply uuid;
  postc uuid;
  fwd uuid[];
  s text;
  n int;
begin
  -- ------------------------------------------------------------- подготовка
  -- Группа A+B (сообщение A), диалог A+D, канал A с попом и постом.
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b, d], 'группа') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);
  perform pg_temp.act_as(a);
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, a, 'text', 'сообщение A') returning id into m;
  perform pg_temp.act_as(b);
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, b, 'text', 'сообщение B') returning id into m_b;

  perform pg_temp.act_as(a);
  dm := (public.create_chat(array[d], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(d);
  perform public.accept_chat_invite(dm);

  perform pg_temp.act_as(a);
  r := public.create_channel('Канал закрепов', 'pins_chan_zz');
  chan := (r ->> 'channel_id')::uuid;
  posts := (r ->> 'chat_id')::uuid;
  r := public.publish_pop(chan, pop, video, 'Поп', 'подпись', true, 'пост', null);
  post := (r ->> 'message_id')::uuid;

  perform pg_temp.act_as(d);
  c1 := public.send_comment(m, 'первый');
  c2 := public.send_comment(m, 'второй');
  reply := public.send_comment(m, 'ответ', '[]'::jsonb, null, c1);
  other := public.send_comment(m_b, 'к сообщению B');
  pc1 := public.send_pop_comment(pop, 'к попу');
  preply := public.send_pop_comment(pop, 'ответ к попу', '[]'::jsonb, null, pc1);
  postc := public.send_comment(post, 'к посту');
  perform pg_temp.act_as(b);
  c3 := public.send_comment(m, 'третий, будет удалён');
  pc2 := public.send_pop_comment(pop, 'второй к попу');

  -- ======================================================== К1.1 — право
  perform pg_temp.act_as(a);
  s := pg_temp.try_pin(c1);
  perform pg_temp.check('автор сообщения закрепляет чужой корень', s = 'прошло', s);
  perform pg_temp.check('закреп лёг', pg_temp.pinned(m) = c1);

  perform pg_temp.act_as(b);
  s := pg_temp.try_pin(c2);
  perform pg_temp.check('другой участник группы — отказ', s like '42501%', s);
  s := pg_temp.try_unpin(m);
  perform pg_temp.check('другой участник группы не открепляет', s like '42501%', s);

  perform pg_temp.act_as(d);
  s := pg_temp.try_pin(c2);
  perform pg_temp.check('посторонний (автор комментария) — отказ', s like '42501%', s);

  perform pg_temp.act_as(a);
  s := pg_temp.try_pin(other);
  perform pg_temp.check('автор чужого сообщения в группе не закрепляет', s like '42501%', s);

  s := pg_temp.try_pin(pc1);
  perform pg_temp.check('публикующий в канале: закреп на попе', s = 'прошло', s);
  s := pg_temp.try_pin(postc);
  perform pg_temp.check('публикующий в канале: закреп на посте', s = 'прошло', s);

  perform pg_temp.act_as(d);
  s := pg_temp.try_pin(pc2);
  perform pg_temp.check('посторонний: закреп на попе — отказ', s like '42501%', s);
  s := pg_temp.try_unpin(pop);
  perform pg_temp.check('посторонний: открепление на попе — отказ', s like '42501%', s);
  s := pg_temp.try_unpin(post);
  perform pg_temp.check('посторонний: открепление на посте — отказ', s like '42501%', s);

  -- Прямая запись мимо функций.
  begin
    insert into public.comment_pins (target_id, comment_id, pinned_by) values (m, c2, d);
    perform pg_temp.check('прямая вставка закрепа — отказ', false, 'прошло');
  exception when others then
    perform pg_temp.check('прямая вставка закрепа — отказ', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.comment_pins set deleted_at = now() where target_id = m;
    get diagnostics n = row_count;
    perform pg_temp.check('прямое снятие закрепа — отказ', false, n::text);
  exception when others then
    perform pg_temp.check('прямое снятие закрепа — отказ', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.check('посторонний видит закреп', (select count(*) from public.comment_pins where target_id = m) = 1);
  perform pg_temp.check('pinned_comment отдаёт закреплённый',
    (select array_agg(id) from public.pinned_comment(m)) = array[c1]);

  -- ============================================= К1.2 — только корень
  perform pg_temp.act_as(a);
  s := pg_temp.try_pin(reply);
  perform pg_temp.check('ответ не закрепляется', s like '22023%', s);
  s := pg_temp.try_pin(preply);
  perform pg_temp.check('ответ к попу не закрепляется', s like '22023%', s);

  perform set_config('role', 'postgres', true);
  begin
    -- У `m_b` закрепа нет: упасть может только составной ключ.
    insert into public.comment_pins (target_id, comment_id, pinned_by) values (m_b, pc2, a);
    perform pg_temp.check('закреп комментария другой цели — отказ схемы', false, 'прошло');
  exception when others then
    perform pg_temp.check('закреп комментария другой цели — отказ схемы', sqlstate = '23503', sqlstate || ' ' || sqlerrm);
  end;
  perform pg_temp.act_as(a);

  -- ================================== К1.3 — один на цель, открепление
  s := pg_temp.try_pin(c2);
  perform pg_temp.check('второй закреп проходит', s = 'прошло', s);
  perform pg_temp.check('у цели один живой закреп — новый',
    (select count(*) from public.comment_pins where target_id = m and deleted_at is null) = 1
    and pg_temp.pinned(m) = c2);

  s := pg_temp.try_pin(c2);
  perform pg_temp.check('повтор закрепа — не ошибка', s = 'прошло'
    and (select count(*) from public.comment_pins where target_id = m and deleted_at is null) = 1, s);

  perform set_config('role', 'postgres', true);
  perform pg_temp.check('прежний закреп снят мягко',
    exists (select 1 from public.comment_pins where target_id = m and comment_id = c1 and deleted_at is not null));
  perform pg_temp.act_as(a);

  -- Страница ранга — целиком, с закреплённым: дубль убирает клиент
  -- (20261012110000_comment_roots_keep_pinned.sql).
  perform pg_temp.check('страница ранга отдаёт и закреплённый',
    exists (select 1 from public.list_comment_thread_roots(m) where id = c2)
    and exists (select 1 from public.list_comment_thread_roots(m) where id = c1));

  s := pg_temp.try_unpin(m);
  perform pg_temp.check('открепление проходит', s = 'прошло' and pg_temp.pinned(m) is null, s);
  perform pg_temp.check('после открепления он снова в ранге',
    exists (select 1 from public.list_comment_thread_roots(m) where id = c2));
  s := pg_temp.try_unpin(m);
  perform pg_temp.check('открепление без закрепа — не ошибка', s = 'прошло', s);

  -- ========================================= К1.4 — удаление снимает закреп
  s := pg_temp.try_pin(c3);
  perform pg_temp.check('закреп комментария B', s = 'прошло', s);
  perform pg_temp.act_as(b);
  perform public.delete_comment(c3);
  perform pg_temp.check('удаление снимает закреп', pg_temp.pinned(m) is null);

  perform pg_temp.act_as(a);
  s := pg_temp.try_pin(c3);
  perform pg_temp.check('удалённый не закрепляется', s like 'P0002%', s);

  -- Удалённая цель: закреплять нечего.
  perform set_config('role', 'postgres', true);
  update public.pops set deleted_at = now() where id = pop;
  perform pg_temp.act_as(a);
  s := pg_temp.try_pin(pc2);
  perform pg_temp.check('у удалённого попа не закрепить', s like 'P0002%', s);

  -- ============================== пересылка комментария к попу
  perform set_config('role', 'postgres', true);
  update public.pops set deleted_at = null where id = pop;
  perform pg_temp.act_as(d);
  fwd := public.forward_comments(dm, array[pc1, pc2, preply]);
  set constraints all immediate;
  set constraints all deferred;

  perform pg_temp.check('комментарии к попу пересылаются',
    (select count(*) from public.messages
     where id = any (fwd) and kind = 'comment_forward' and forwarded_comment_id = any (array[pc1, pc2, preply])) = 3);
  perform pg_temp.check('превью — текст комментария',
    (select public.last_message_preview(ch) from public.chat_rows ch where ch.id = dm) like '💬 %');

  perform pg_temp.act_as(b);
  begin
    perform public.forward_comments(dm, array[pc1]);
    perform pg_temp.check('посторонний чату не пересылает в него', false, 'прошло');
  exception when others then
    perform pg_temp.check('посторонний чату не пересылает в него', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform set_config('role', 'postgres', true);
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
