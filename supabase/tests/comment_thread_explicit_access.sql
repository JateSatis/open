-- Ответ в тред без цитаты: явный корень в `send_comment` и `send_voice_comment`.
--
-- Запуск против облачной базы, ничего не оставляет — всё в транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/comment_thread_explicit_access.sql
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
  ('00000000-0000-4000-8000-0000000000aa', 'xa@test.local', '{"full_name":"Участник A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000ba', 'xb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000da', 'xd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000ba';
  d uuid := '00000000-0000-4000-8000-0000000000da';
  voice jsonb := '{"url":"https://x/v.m4a","mime_type":"audio/mp4","duration_ms":1000}'::jsonb;
  chat uuid;
  m uuid;
  m2 uuid;
  root1 uuid;
  root2 uuid;
  other_root uuid;
  r1 uuid;
  r2 uuid;
  s text;
  n int;
begin
  -- ------------------------------------------------------------- подготовка
  -- A и B — участники чата, D — посторонний посетитель.
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);

  perform pg_temp.act_as(a);
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, a, 'text', 'сообщение') returning id into m;
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, a, 'text', 'другое сообщение') returning id into m2;
  root1 := public.send_comment(m, 'первый корень');
  root2 := public.send_comment(m, 'второй корень');
  other_root := public.send_comment(m2, 'корень другого сообщения');

  -- ====================================================== тред без цитаты
  perform pg_temp.act_as(d);
  r1 := public.send_comment(m, 'посторонний пишет в тред', '[]'::jsonb, null, root1);
  select coalesce(thread_root_id::text, '∅') || '|' || audience into s from public.comments where id = r1;
  perform pg_temp.check('посторонний пишет в тред без цитаты', s = root1::text || '|visitor', s);

  select count(*) into n from public.comment_replies where comment_id = r1;
  perform pg_temp.check('ответ без цитаты — без цитат', n = 0, n::text);

  r2 := public.send_voice_comment(m, voice, null, root1);
  select thread_root_id::text into s from public.comments where id = r2;
  perform pg_temp.check('голосовое в тред без цитаты', s = root1::text, s);

  r2 := public.send_comment(m, 'с цитатой ответа', '[]'::jsonb, array[r1], root1);
  select thread_root_id::text || '|' || (select quoted_id::text from public.comment_replies where comment_id = r2)
  into s from public.comments where id = r2;
  perform pg_temp.check('явный тред и цитата из него', s = root1::text || '|' || r1::text, s);

  r2 := public.send_comment(m, 'наверх');
  select coalesce(thread_root_id::text, '∅') into s from public.comments where id = r2;
  perform pg_temp.check('без треда и цитат — верхнеуровневый', s = '∅', s);

  -- =============================================================== отказы
  begin
    perform public.send_comment(m, 'цитата из другого треда', '[]'::jsonb, array[root2], root1);
    perform pg_temp.check('цитата из другого треда отвергнута', false, 'прошло');
  exception when others then
    perform pg_temp.check('цитата из другого треда отвергнута', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_comment(m, 'корень чужого сообщения', '[]'::jsonb, null, other_root);
    perform pg_temp.check('корень из другого сообщения — отказ', false, 'прошло');
  exception when others then
    perform pg_temp.check('корень из другого сообщения — отказ', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_comment(m, 'ответ в роли корня', '[]'::jsonb, null, r1);
    perform pg_temp.check('ответ в роли корня — отказ', false, 'прошло');
  exception when others then
    perform pg_temp.check('ответ в роли корня — отказ', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_voice_comment(m, voice, null, r1);
    perform pg_temp.check('голосовое: ответ в роли корня — отказ', false, 'прошло');
  exception when others then
    perform pg_temp.check('голосовое: ответ в роли корня — отказ', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_comment(m, 'нет такого корня', '[]'::jsonb, null, gen_random_uuid());
    perform pg_temp.check('несуществующий корень — отказ', false, 'прошло');
  exception when others then
    perform pg_temp.check('несуществующий корень — отказ', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  -- ======================================================= удалённый корень
  perform pg_temp.act_as(a);
  perform public.delete_comment(root1);

  perform pg_temp.act_as(d);
  r2 := public.send_comment(m, 'тред удалённого корня', '[]'::jsonb, null, root1);
  select thread_root_id::text into s from public.comments where id = r2;
  perform pg_temp.check('в тред удалённого корня пишут без цитаты', s = root1::text, s);

  r2 := public.send_voice_comment(m, voice, null, root1);
  select thread_root_id::text into s from public.comments where id = r2;
  perform pg_temp.check('голосовое в тред удалённого корня', s = root1::text, s);

  perform pg_temp.as_service();
  select replies_count into n from public.comments where id = root1;
  perform pg_temp.check('число ответов у удалённого корня растёт', n = 5, n::text);

  -- ================================================================ без входа
  perform pg_temp.act_as_anon();
  begin
    perform public.send_comment(m, 'аноним', '[]'::jsonb, null, root2);
    perform pg_temp.check('без входа в тред не написать', false, 'прошло');
  exception when others then
    perform pg_temp.check('без входа в тред не написать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
