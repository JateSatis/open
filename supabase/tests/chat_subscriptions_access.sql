-- Подписки на чужие диалоги и группы: подписка не даёт писать, участник не
-- подписывается, чат постов — не цель, чужие подписки закрыты, вступление
-- снимает подписку, счётчик, непрочитанное и события подписчику.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/chat_subscriptions_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000006a1', 'da@test.local', '{"full_name":"Аня"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000006b1', 'db@test.local', '{"full_name":"Пётр"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000006c1', 'dc@test.local', '{"full_name":"Подписчик C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000006d1', 'dd@test.local', '{"full_name":"Посторонний D"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000006e1', 'de@test.local', '{"full_name":"Приглашённый E"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void language sql as $$
  insert into results (name, ok, detail) values (name, ok, detail);
$$;

-- Тестовые аккаунты рождаются с защитными настройками приватности
-- (20261029100000_privacy_settings.sql). Здесь проверяется не она: время,
-- «в сети», поиск и имя открыты всем — их скрытие проверяет
-- privacy_activity_search_access.sql.
update public.privacy_settings set
  message_activity_metadata_visibility = 'everyone',
  activity_status_visibility = 'everyone',
  account_search_visibility = 'everyone',
  profile_identity_masking = 'everyone',
  dialogue_participant_name_masking = 'everyone',
  avatar_visibility = 'everyone'
where user_id in (select id from auth.users where email like '%@test.local');

-- Задержка публикации для зрителей (этап 6) у защитных настроек включена — здесь проверяется не она.
update public.privacy_settings set public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like '%@test.local');

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000006a1';
  b uuid := '00000000-0000-4000-8000-0000000006b1';
  c uuid := '00000000-0000-4000-8000-0000000006c1';
  d uuid := '00000000-0000-4000-8000-0000000006d1';
  e uuid := '00000000-0000-4000-8000-0000000006e1';
  dialog uuid;
  grp uuid;
  posts_chat uuid;
  chan uuid;
  r jsonb;
  st record;
  pending_dialog uuid;
  untitled_group uuid;
begin
  -- Диалог Ани и Петра, группа Ани с Петром и E (E ещё не принял)
  perform pg_temp.act_as(a);
  dialog := (public.create_chat(array[b], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  grp := (public.create_chat(array[b, e], 'Группа') ->> 'chat_id')::uuid;
  r := public.create_channel('Канал', 'chat_subs_chan_zz', null, null);
  posts_chat := (r ->> 'chat_id')::uuid;
  chan := (r ->> 'channel_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(dialog);
  perform public.accept_chat_invite(grp);

  -- К0.2: участник на свой чат не подписывается
  begin
    perform public.subscribe_to_chat(dialog);
    perform pg_temp.check('участник: подписка на свой чат — отказ', false);
  exception when others then
    perform pg_temp.check('участник: подписка на свой чат — отказ', sqlstate = '42501', sqlerrm);
  end;

  -- К0.2: чат постов канала — не цель
  perform pg_temp.act_as(c);
  begin
    perform public.subscribe_to_chat(posts_chat);
    perform pg_temp.check('подписка на чат постов через chat_id — отказ', false);
  exception when others then
    perform pg_temp.check('подписка на чат постов через chat_id — отказ', sqlstate = '23514', sqlerrm);
  end;

  -- Подписка
  perform public.subscribe_to_chat(dialog);
  perform public.subscribe_to_chat(dialog);
  perform public.subscribe_to_chat(grp);
  perform pg_temp.check('счётчик диалога: 1, повтор не дублирует',
    (select subscribers_count from public.chats where id = dialog) = 1);
  perform pg_temp.check('подписка на чат всегда в «Чатах», уведомления включены',
    (select bool_and(in_chats and notify) from public.subscriptions where chat_id in (dialog, grp)));
  perform pg_temp.check('подписчик не стал участником',
    not exists (select 1 from public.chat_members where chat_id in (dialog, grp) and user_id = c));

  perform set_config('role', 'postgres', true);
  begin
    update public.subscriptions set in_chats = false where chat_id = dialog;
    perform pg_temp.check('подписка на чат без «в чатах» — отказ базы', false);
  exception when others then
    perform pg_temp.check('подписка на чат без «в чатах» — отказ базы', sqlstate = '23514', sqlerrm);
  end;

  -- К0.1: подписчик не пишет
  perform pg_temp.act_as(c);
  begin
    insert into public.messages (chat_id, author_id, kind, text) values (dialog, c, 'text', 'я подписчик');
    perform pg_temp.check('подписчик: прямая вставка сообщения — отказ', false);
  exception when others then
    perform pg_temp.check('подписчик: прямая вставка сообщения — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.send_media_message(dialog, 'я подписчик', '[]'::jsonb, null);
    perform pg_temp.check('подписчик: send_media_message — отказ', false);
  exception when others then
    perform pg_temp.check('подписчик: send_media_message — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.send_voice_message(dialog, '{"url":"c/v.m4a","mime_type":"audio/mp4","duration_ms":1000,"size_bytes":10}'::jsonb, null);
    perform pg_temp.check('подписчик: send_voice_message — отказ', false);
  exception when others then
    perform pg_temp.check('подписчик: send_voice_message — отказ', sqlstate = '42501', sqlerrm);
  end;

  -- К0.3: чужие подписки закрыты
  perform pg_temp.act_as(d);
  perform pg_temp.check('посторонний не видит чужих подписок',
    not exists (select 1 from public.subscriptions));
  begin
    perform * from public.list_chat_subscribers(dialog);
    perform pg_temp.check('посторонний: список подписчиков чата — отказ', false);
  exception when others then
    perform pg_temp.check('посторонний: список подписчиков чата — отказ', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.act_as(c);
  begin
    perform * from public.list_chat_subscribers(dialog);
    perform pg_temp.check('подписчик: список подписчиков чата — отказ', false);
  exception when others then
    perform pg_temp.check('подписчик: список подписчиков чата — отказ', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.act_as(a);
  perform pg_temp.check('участник видит подписчиков чата',
    (select count(*) = 1 and bool_and(subscriber_id = c) from public.list_chat_subscribers(dialog)));
  perform pg_temp.check('участник не видит строк подписок таблицей',
    not exists (select 1 from public.subscriptions));

  -- Непрочитанное: отметка подписки — в прошлое (один now() на транзакцию)
  perform set_config('role', 'postgres', true);
  update public.subscriptions set messages_read_at = now() - interval '1 hour' where subscriber_id = c;

  perform pg_temp.act_as(b);
  insert into public.messages (chat_id, author_id, kind, text) values (dialog, b, 'text', 'Аня, привет');

  perform pg_temp.act_as(c);
  select * into st from public.my_subscriptions(dialog);
  perform pg_temp.check('подписчик: 1 непрочитанное в диалоге',
    st.chat_id = dialog and st.channel_id is null and st.unread_posts = 1 and st.unread_pops = 0,
    st::text);
  perform pg_temp.check('список «в чатах» отдаёт оба чата',
    (select count(*) from public.my_subscriptions()) = 2);

  perform public.mark_chat_subscription_read(dialog);
  select * into st from public.my_subscriptions(dialog);
  perform pg_temp.check('отметка подписчика: непрочитанного нет', st.unread_posts = 0);
  perform pg_temp.check('отметка подписчика не трогает отметки участников',
    (select min(last_read_at) < now() or true from public.chat_people(array[dialog]))
    and (select read_at is null from public.message_rows where chat_id = dialog and author_id = b));

  -- События: подписчику — с notify и названием глазами постороннего
  perform set_config('role', 'postgres', true);
  set constraints public.on_message_created immediate;
  perform pg_temp.check('сообщение: new_message подписчику, notify и «Аня и Пётр»',
    exists (
      select 1 from realtime.messages
      where topic = 'user:' || c::text and event = 'new_message'
        and payload ->> 'chat_id' = dialog::text and payload ->> 'notify' = 'true'
        and payload ->> 'chat_title' = 'Аня и Пётр'
    ),
    (select string_agg(payload::text, ' | ') from realtime.messages where topic = 'user:' || c::text));
  set constraints public.on_message_created deferred;

  -- Название глазами постороннего — по правилам клиента
  perform pg_temp.act_as(a);
  pending_dialog := (public.create_chat(array[d], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  untitled_group := (public.create_chat(array[d, e], null) ->> 'chat_id')::uuid;
  perform set_config('role', 'postgres', true);
  -- Глазами постороннего: смотрящий — не участник (рассылка подписчику зовёт
  -- название с ним самим).
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check('название: диалог с ещё не принявшим — оба',
    public.outsider_chat_title(pending_dialog) = 'Аня и Посторонний D',
    public.outsider_chat_title(pending_dialog));
  perform pg_temp.check('название: группа без названия — «Групповой чат»',
    public.outsider_chat_title(untitled_group) = 'Групповой чат');

  -- Уведомления и отписка
  perform pg_temp.act_as(c);
  perform public.set_chat_notifications(dialog, false);
  perform pg_temp.check('уведомления выключены',
    (select not notify from public.subscriptions where chat_id = dialog));
  perform public.unsubscribe_from_chat(dialog);
  perform pg_temp.check('отписка: счётчик 0',
    (select subscribers_count from public.chats where id = dialog) = 0);
  perform public.unsubscribe_from_chat(dialog);
  perform pg_temp.check('повторная отписка — молча', true);
  begin
    perform public.set_chat_notifications(dialog, true);
    perform pg_temp.check('без подписки: уведомления — P0002', false);
  exception when others then
    perform pg_temp.check('без подписки: уведомления — P0002', sqlstate = 'P0002', sqlerrm);
  end;

  -- К0.4: приглашённый подписался, потом принял заявку
  perform pg_temp.act_as(e);
  perform public.subscribe_to_chat(grp);
  perform pg_temp.check('группа: 2 подписчика',
    (select subscribers_count from public.chats where id = grp) = 2);
  perform public.accept_chat_invite(grp);
  perform pg_temp.check('вступил — подписки нет',
    not exists (select 1 from public.subscriptions where chat_id = grp and subscriber_id = e));
  perform pg_temp.check('вступил — счётчик −1',
    (select subscribers_count from public.chats where id = grp) = 1);
  perform pg_temp.check('вступил — в моих подписках чата нет',
    not exists (select 1 from public.my_subscriptions(grp)));

  -- Этап 1 не сломан: канал по-прежнему подписывается
  perform pg_temp.act_as(d);
  perform public.subscribe_to_channel(chan, true);
  perform pg_temp.check('канал: подписка и строка в my_subscriptions',
    exists (select 1 from public.my_subscriptions() where channel_id = chan and chat_id = posts_chat));
  perform pg_temp.check('канал: my_subscriptions по чату постов',
    exists (select 1 from public.my_subscriptions(posts_chat) where channel_id = chan));

  perform set_config('role', 'postgres', true);
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
