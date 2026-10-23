-- Подписки на каналы: кто может подписаться, что подписка не даёт писать,
-- кто видит чужие подписки, счётчики, непрочитанное и события читателям.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/channel_subscriptions_access.sql
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
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000005a1', 'sa@test.local', '{"full_name":"Владелец A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000005b1', 'sb@test.local', '{"full_name":"Читатель B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000005c1', 'sc@test.local', '{"full_name":"Подписчик C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000005d1', 'sd@test.local', '{"full_name":"Посторонний D"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void language sql as $$
  insert into results (name, ok, detail) values (name, ok, detail);
$$;

-- Задержка публикации для зрителей (этап 6) у защитных настроек включена — здесь проверяется не она.
update public.privacy_settings set public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like '%@test.local');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000005a1';
  b uuid := '00000000-0000-4000-8000-0000000005b1';
  c uuid := '00000000-0000-4000-8000-0000000005c1';
  d uuid := '00000000-0000-4000-8000-0000000005d1';
  video jsonb := '{"url":"https://proj.supabase.co/storage/v1/object/public/media/a/pops/v.mp4","poster_url":"https://proj.supabase.co/storage/v1/object/public/media/a/pops/p.jpg","mime_type":"video/mp4","width":720,"height":1280,"duration_ms":5000}';
  r jsonb;
  chat uuid;
  chan uuid;
  pop1 uuid := gen_random_uuid();
  pop2 uuid := gen_random_uuid();
  st record;
begin
  perform pg_temp.act_as(a);
  r := public.create_channel('Подписки', 'subs_chan_zz', null, null);
  chat := (r ->> 'chat_id')::uuid;
  chan := (r ->> 'channel_id')::uuid;

  -- К0.1: на свой канал не подписываются
  begin
    perform public.subscribe_to_channel(chan, true);
    perform pg_temp.check('создатель: подписка на свой канал — отказ', false);
  exception when others then
    perform pg_temp.check('создатель: подписка на свой канал — отказ', sqlstate = '42501', sqlerrm);
  end;

  -- Читатель и подписчик без чатов
  perform pg_temp.act_as(b);
  perform public.subscribe_to_channel(chan, true);
  perform pg_temp.act_as(c);
  perform public.subscribe_to_channel(chan, false);

  perform pg_temp.check('счётчики: 2 подписчика, 1 читатель',
    (select subscribers_count = 2 and readers_count = 1 from public.channels where id = chan),
    (select subscribers_count || '/' || readers_count from public.channels where id = chan));

  perform public.subscribe_to_channel(chan, false);
  perform pg_temp.check('повторная подписка не дублирует',
    (select subscribers_count from public.channels where id = chan) = 2);

  perform pg_temp.check('подписчик не стал участником чата постов',
    not exists (select 1 from public.chat_members where chat_id = chat and user_id in (b, c)));

  -- К0.2: подписка не даёт публиковать
  perform pg_temp.act_as(b);

  begin
    insert into public.messages (chat_id, author_id, kind, text) values (chat, b, 'text', 'пост читателя');
    perform pg_temp.check('читатель: прямая вставка поста — отказ', false);
  exception when others then
    perform pg_temp.check('читатель: прямая вставка поста — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.send_media_message(chat, 'пост читателя', '[]'::jsonb, null);
    perform pg_temp.check('читатель: send_media_message — отказ', false);
  exception when others then
    perform pg_temp.check('читатель: send_media_message — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.publish_pop(chan, gen_random_uuid(), video, 'Поп', null, true, 'x', null);
    perform pg_temp.check('читатель: publish_pop — отказ', false);
  exception when others then
    perform pg_temp.check('читатель: publish_pop — отказ', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.check('читатель не может публиковать', not public.can_publish_in_channel(chan));

  -- Прямая запись в таблицу подписок закрыта
  begin
    insert into public.subscriptions (subscriber_id, channel_id) values (d, chan);
    perform pg_temp.check('прямая вставка подписки — отказ', false);
  exception when others then
    perform pg_temp.check('прямая вставка подписки — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    update public.subscriptions set messages_read_at = now() + interval '1 day' where subscriber_id = b;
    perform pg_temp.check('прямая правка подписки — отказ', false);
  exception when others then
    perform pg_temp.check('прямая правка подписки — отказ', sqlstate = '42501', sqlerrm);
  end;

  -- К0.3: чужие подписки не читаются
  perform pg_temp.check('читатель видит только свою строку',
    (select array_agg(subscriber_id) from public.subscriptions) = array[b]);

  begin
    perform * from public.list_channel_subscribers(chan);
    perform pg_temp.check('читатель: список подписчиков — отказ', false);
  exception when others then
    perform pg_temp.check('читатель: список подписчиков — отказ', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.act_as(d);
  perform pg_temp.check('посторонний не видит ни одной подписки',
    not exists (select 1 from public.subscriptions));
  perform pg_temp.check('посторонний: my_channel_subscriptions пуст',
    not exists (select 1 from public.my_channel_subscriptions(chan)));

  begin
    perform * from public.list_channel_subscribers(chan);
    perform pg_temp.check('посторонний: список подписчиков — отказ', false);
  exception when others then
    perform pg_temp.check('посторонний: список подписчиков — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.subscription_unread_pops(chan, now() - interval '1 day', b);
    perform pg_temp.check('посторонний: внутренний счёт непрочитанного закрыт', false);
  exception when others then
    perform pg_temp.check('посторонний: внутренний счёт непрочитанного закрыт', sqlstate = '42501', sqlerrm);
  end;

  -- К12.1: создатель видит всех, у читателя пометка
  perform pg_temp.act_as(a);
  perform pg_temp.check('создатель видит подписчиков с пометкой «в чатах»',
    (select count(*) = 2 and bool_and(in_chats = (subscriber_id = b))
     from public.list_channel_subscribers(chan)));
  perform pg_temp.check('создатель видит в таблице только свои строки (их нет)',
    not exists (select 1 from public.subscriptions));
  perform pg_temp.check('страница подписчиков по ключу',
    (select count(*) from public.list_channel_subscribers(chan, null, null, 1)) = 1);

  -- Непрочитанное: всё внутри одной транзакции одним now(), поэтому отметки
  -- подписки отводятся в прошлое вручную.
  perform set_config('role', 'postgres', true);
  update public.subscriptions
  set messages_read_at = now() - interval '1 hour', pops_read_at = now() - interval '1 hour'
  where channel_id = chan;

  perform pg_temp.act_as(a);
  insert into public.messages (chat_id, author_id, kind, text) values (chat, a, 'text', 'пост 1');
  perform public.publish_pop(chan, pop1, video, 'Поп', null, false, null, null);
  perform public.publish_pop(chan, pop2, video, 'Поп', null, true, 'пост с попом', null);

  perform pg_temp.check('last_pop_at — время свежего попа',
    (select last_pop_at = now() from public.channels where id = chan));

  perform pg_temp.act_as(b);
  select * into st from public.my_channel_subscriptions() limit 1;
  perform pg_temp.check('читатель: канал в списке «в чатах»', st.channel_id = chan and st.chat_id = chat);
  perform pg_temp.check('читатель: 2 непрочитанных поста, 2 попса',
    st.unread_posts = 2 and st.unread_pops = 2, st.unread_posts || '/' || st.unread_pops);

  -- Просмотр попа с постом читает и пост с ним (К3.4)
  perform public.record_pop_views(array[pop2], gen_random_uuid());
  select * into st from public.my_channel_subscriptions(chan);
  perform pg_temp.check('просмотр попа читает его и пост с ним',
    st.unread_posts = 1 and st.unread_pops = 1, st.unread_posts || '/' || st.unread_pops);

  perform public.mark_channel_read(chan, true, false);
  select * into st from public.my_channel_subscriptions(chan);
  perform pg_temp.check('прочитаны посты — попсы остались',
    st.unread_posts = 0 and st.unread_pops = 1, st.unread_posts || '/' || st.unread_pops);

  perform public.mark_channel_read(chan, false, true);
  select * into st from public.my_channel_subscriptions(chan);
  perform pg_temp.check('прочитаны попсы', st.unread_pops = 0);

  perform pg_temp.act_as(c);
  perform pg_temp.check('подписчик без чатов: в списке «в чатах» нет',
    not exists (select 1 from public.my_channel_subscriptions()));
  select * into st from public.my_channel_subscriptions(chan);
  perform pg_temp.check('подписчик без чатов: непрочитанное считается',
    st.unread_posts = 2 and st.unread_pops = 2 and not st.in_chats);

  -- Галочки прочтения — только по участникам (К3.8)
  perform pg_temp.check('прочтение подписчика не трогает отметки участников',
    (select count(*) from public.chat_people(array[chat])) = 1);

  -- События читателю. Оба триггера рассылки отложены до фиксации — здесь
  -- их срабатывание вызывается сразу.
  perform set_config('role', 'postgres', true);
  set constraints public.on_message_created, public.pops_broadcast_new immediate;
  perform pg_temp.check('пост: new_message читателю, с notify',
    exists (
      select 1 from realtime.messages
      where topic = 'user:' || b::text and event = 'new_message'
        and payload ->> 'chat_id' = chat::text and payload ->> 'notify' = 'true'
        and payload ->> 'channel_title' = 'Подписки'
    ));
  perform pg_temp.check('пост: подписчику без чатов событий нет',
    not exists (select 1 from realtime.messages where topic = 'user:' || c::text));

  perform pg_temp.check('поп без поста: new_pop читателю',
    exists (
      select 1 from realtime.messages
      where topic = 'user:' || b::text and event = 'new_pop' and payload ->> 'pop_id' = pop1::text
    ));
  -- Удалённый до фиксации поп не рассылается.
  set constraints public.on_message_created, public.pops_broadcast_new deferred;
  perform pg_temp.act_as(a);
  perform public.publish_pop(chan, '00000000-0000-4000-8000-0000000005f1', video, 'Поп', null, false, null, null);
  perform set_config('role', 'postgres', true);
  update public.pops set deleted_at = now() where id = '00000000-0000-4000-8000-0000000005f1';
  set constraints public.on_message_created, public.pops_broadcast_new immediate;
  perform pg_temp.check('удалённый до фиксации поп: new_pop нет',
    not exists (
      select 1 from realtime.messages
      where event = 'new_pop' and payload ->> 'pop_id' = '00000000-0000-4000-8000-0000000005f1'
    ));
  perform pg_temp.check('поп с постом: отдельного new_pop нет',
    not exists (
      select 1 from realtime.messages
      where topic = 'user:' || b::text and event = 'new_pop' and payload ->> 'pop_id' = pop2::text
    ));
  set constraints public.on_message_created, public.pops_broadcast_new deferred;

  -- Удаление попа откатывает last_pop_at
  update public.pops set created_at = now() - interval '10 minutes' where id = pop1;
  update public.pops set deleted_at = now() where id = pop2;
  perform pg_temp.check('удалён свежий поп — last_pop_at к предыдущему',
    (select last_pop_at = now() - interval '10 minutes' from public.channels where id = chan));

  -- Уведомления, чаты, отписка
  perform pg_temp.act_as(b);
  perform public.set_channel_notifications(chan, false);
  perform pg_temp.check('уведомления выключены',
    (select not notify from public.subscriptions where channel_id = chan));

  perform public.set_channel_in_chats(chan, false);
  perform pg_temp.check('убран из чатов: читателей 0, подписчиков 2',
    (select readers_count = 0 and subscribers_count = 2 from public.channels where id = chan));

  perform public.unsubscribe_from_channel(chan);
  perform pg_temp.check('отписка: подписчиков 1',
    (select subscribers_count = 1 from public.channels where id = chan));

  begin
    perform public.set_channel_in_chats(chan, true);
    perform pg_temp.check('без подписки: в чаты — P0002', false);
  exception when others then
    perform pg_temp.check('без подписки: в чаты — P0002', sqlstate = 'P0002', sqlerrm);
  end;

  perform public.mark_channel_read(chan);
  perform pg_temp.check('без подписки: отметка прочтения — молча', true);

  perform set_config('role', 'postgres', true);
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
