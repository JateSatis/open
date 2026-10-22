-- Поиск в «Ленте»: каналы одним списком, попсы по названию и подписи попа и
-- по названию и @имени канала, ранг, скор, курсор, удалённое.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/search_feed_access.sql
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

-- Функции поиска ставят порог pg_trgm: модуль должен быть загружен в сессии.
select extensions.similarity('a', 'b');

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000fa', 'fa@test.local', '{"full_name":"Автор A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000fb', 'fb@test.local', '{"full_name":"Зритель B"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void language sql as $$
  insert into results (name, ok, detail) values (name, ok, detail);
$$;

/** Названия (или подписи) найденных попсов тестовых каналов по порядку выдачи. */
create function pg_temp.pops(q text) returns text[] language sql as $$
  select coalesce(array_agg(coalesce(title, caption) order by n), '{}')
  from (
    select row_number() over () as n, * from public.search_pops(q, null, null, null, null, 100)
  ) r
  where channel_title like 'zz %';
$$;

create function pg_temp.channels(q text) returns text[] language sql as $$
  select coalesce(array_agg(title order by n), '{}')
  from (select row_number() over () as n, * from public.search_channels(q, 100)) r
  where title like 'zz %';
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000fa';
  b uuid := '00000000-0000-4000-8000-0000000000fb';
  video jsonb := '{"url":"https://proj.supabase.co/storage/v1/object/public/media/fa/pops/v.mp4","poster_url":"https://proj.supabase.co/storage/v1/object/public/media/fa/pops/p.jpg","mime_type":"video/mp4","width":720,"height":1280,"duration_ms":5000}';
  chan uuid;
  other uuid;
  gone uuid;
  hot uuid := gen_random_uuid();
  cold uuid := gen_random_uuid();
  dead uuid := gen_random_uuid();
  got text[];
  page1 record;
  seen uuid[] := '{}';
  total int;
  cur record;
  i int;
begin
  perform pg_temp.act_as(a);

  chan := (public.create_channel('zz Кухня', 'zz_kuhnya') ->> 'channel_id')::uuid;
  other := (public.create_channel('zz Ёлочный базар', 'zz_elki_bazar') ->> 'channel_id')::uuid;
  gone := (public.create_channel('zz Ёлки удалённые', 'zz_elki_gone') ->> 'channel_id')::uuid;

  perform public.publish_pop(chan, gen_random_uuid(), video, 'Ёлка', null);
  perform public.publish_pop(chan, gen_random_uuid(), video, 'Праздник', 'Нарядили с ёлкой вместе');
  perform public.publish_pop(chan, gen_random_uuid(), video, 'Новый телеграм', null);
  perform public.publish_pop(chan, hot, video, 'Борщ горячий', null);
  perform public.publish_pop(chan, cold, video, 'Борщ холодный', null);
  perform public.publish_pop(chan, dead, video, 'Ёлка удалённая', null);
  perform public.publish_pop(other, gen_random_uuid(), video, 'Гирлянды', null);
  perform public.publish_pop(gone, gen_random_uuid(), video, 'Ёлка в удалённом канале', null);

  for i in 1 .. 35 loop
    perform public.publish_pop(chan, gen_random_uuid(), video, 'Суп номер ' || i, null);
  end loop;

  perform pg_temp.as_owner();
  update public.pops set deleted_at = now() where id = dead;
  update public.channels set deleted_at = now() where id = gone;
  -- Одинаковое совпадение, сравнимый возраст: у «горячего» больше сигналов.
  update public.pops set views_count = 500, reactions_count = 20 where id = hot;
  update public.pops set views_count = 3 where id = cold;

  perform pg_temp.act_as(b);

  -- К2.1: ё/е и морфология — по названию и по подписи.
  got := pg_temp.pops('елка');
  perform pg_temp.check('«елка» — «Ёлка» по названию и «ёлкой» в подписи',
    got[1] = 'Ёлка' and 'Праздник' = any (got), got::text);

  -- Удалённое не выдаётся.
  perform pg_temp.check('удалённый поп и попсы удалённого канала не выдаются',
    not ('Ёлка удалённая' = any (got)) and not ('Ёлка в удалённом канале' = any (got)), got::text);

  -- К2.2: опечатка находит, ниже точных.
  got := pg_temp.pops('тлеграм');
  perform pg_temp.check('опечатка «тлеграм» находит «Новый телеграм»',
    'Новый телеграм' = any (got), got::text);
  perform pg_temp.check('опечатка ниже точного совпадения',
    (select rank from public.search_pops('тлеграм') where title = 'Новый телеграм')
      < (select rank from public.search_pops('телеграм') where title = 'Новый телеграм'));

  -- К2.3: по названию канала — канал в блоке и его попсы, ниже своего текста того же уровня.
  perform pg_temp.check('«базар» — канал в блоке',
    pg_temp.channels('базар') = array['zz Ёлочный базар'], pg_temp.channels('базар')::text);
  got := pg_temp.pops('базар');
  perform pg_temp.check('«базар» — попсы канала в сетке', got = array['Гирлянды'], got::text);
  got := pg_temp.pops('ёлочный');
  perform pg_temp.check('свой текст выше совпадения только по каналу того же уровня',
    (select rank from public.search_pops('елка') where title = 'Ёлка')
      > (select rank from public.search_pops('ёлочный') where title = 'Гирлянды'),
    got::text);

  -- К2.4: @имя — канал по @имени первым.
  got := pg_temp.channels('@zz_elki');
  perform pg_temp.check('@имя — канал по @имени первым', got[1] = 'zz Ёлочный базар', got::text);

  -- `.di` — каналов нет; `.ch` — только каналы (здесь и так только они).
  perform pg_temp.check('.di — в «Ленте» каналов нет',
    cardinality(pg_temp.channels('zz_elki.di')) = 0);
  perform pg_temp.check('.ch — канал находится',
    (pg_temp.channels('zz_elki.ch'))[1] = 'zz Ёлочный базар', pg_temp.channels('zz_elki.ch')::text);

  -- К2.5: одинаковое совпадение — выше популярный.
  got := pg_temp.pops('борщ');
  perform pg_temp.check('при равном совпадении выше больше просмотров и реакций',
    got = array['Борщ горячий', 'Борщ холодный'], got::text);

  -- Короткий запрос не приводит попсы каналов, где буква внутри слова.
  got := pg_temp.pops('х');
  perform pg_temp.check('одна буква внутри названия канала не приводит его попсы',
    not ('Суп номер 1' = any (got)), got::text);

  -- К2.6: страницы по курсору — без дублей и пропусков, момент общий.
  select count(*) into total from public.search_pops('суп', null, null, null, null, 100);
  select * into cur from public.search_pops('суп', null, null, null, null, 10) offset 9 limit 1;
  select array_agg(id) into seen from public.search_pops('суп', null, null, null, null, 10);
  while cur.id is not null loop
    seen := seen || array(
      select id from public.search_pops('суп', cur.scored_at, cur.rank, cur.score, cur.id, 10)
    );
    select * into page1 from public.search_pops('суп', cur.scored_at, cur.rank, cur.score, cur.id, 10)
      offset 9 limit 1;
    cur := page1;
  end loop;
  perform pg_temp.check('страницы курсором — все попсы, без дублей',
    total = 35 and cardinality(seen) = 35
      and (select count(distinct x) from unnest(seen) x) = 35,
    total || ' / ' || cardinality(seen));

  -- Ничего не пишут: поиск доступен любому вошедшему, запись — только функциям.
  begin
    perform pg_temp.act_as(b);
    update public.pops set title = 'взлом' where channel_id = chan;
    perform pg_temp.check('посторонний не правит название попа',
      not exists (select 1 from public.pops where title = 'взлом'));
  exception when others then
    perform pg_temp.check('посторонний не правит название попа', sqlstate = '42501', sqlerrm);
  end;
end;
$$;

reset role;

select n, name, ok, detail from results order by n;

rollback;
