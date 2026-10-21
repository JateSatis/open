-- Журнал рекомендаций (этап 1): серверные события из существующих таблиц.
-- Каждое действие человека даёт ровно одно событие нужного вида с
-- правильными полями; реакция, снятая быстро, помечена.
--
-- Отложенные триггеры (комментарии, сообщения) срабатывают при коммите —
-- тест вызывает их `set constraints … immediate`.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/rec_journal_server_events.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000008a1', 'sa@test.local', '{"full_name":"Автор канала"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000008b1', 'sb@test.local', '{"full_name":"Зритель B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000008c1', 'sc@test.local', '{"full_name":"Друг C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000008d1', 'sd@test.local', '{"full_name":"Участник D"}', 'authenticated', 'authenticated');

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

/** Забыть события человека: следующая проверка видит только новое. */
create function pg_temp.forget(u uuid) returns void language plpgsql as $$
begin
  perform pg_temp.as_service();
  delete from public.rec_events where user_id = u;
end;
$$;

/** Отложенные триггеры журнала — сейчас. */
create function pg_temp.flush() returns void language plpgsql as $$
begin
  set constraints public.comments_rec_journal, public.messages_rec_journal immediate;
  set constraints public.comments_rec_journal, public.messages_rec_journal deferred;
end;
$$;

/** Ровно одно событие человека этого вида; отдаёт его. */
create function pg_temp.one(u uuid) returns public.rec_events
language plpgsql as $$
declare
  e public.rec_events;
begin
  perform pg_temp.flush();
  perform pg_temp.as_service();

  if (select count(*) from public.rec_events where user_id = u) <> 1 then
    return null;
  end if;

  select * into e from public.rec_events where user_id = u;
  return e;
end;
$$;

create function pg_temp.dump(u uuid) returns text
language sql as $$
  select coalesce(string_agg(kind || ' ' || coalesce(subject_type, '') || ' ' || data::text, ' | '), 'нет событий')
  from public.rec_events where user_id = u
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000008a1';
  b uuid := '00000000-0000-4000-8000-0000000008b1';
  c uuid := '00000000-0000-4000-8000-0000000008c1';
  d uuid := '00000000-0000-4000-8000-0000000008d1';
  video jsonb := '{"url":"s1/pops/v.mp4","poster_url":"s1/pops/p.jpg","mime_type":"video/mp4","width":720,"height":1280,"duration_ms":8000}';
  r jsonb;
  chan uuid;
  posts uuid;
  post uuid;
  pop uuid := gen_random_uuid();
  dm uuid;
  grp uuid;
  m_c uuid;
  m_a uuid;
  m_b uuid;
  cm uuid;
  e public.rec_events;
begin
  perform pg_temp.act_as(a);
  r := public.create_channel('Серверные события', 'rec_server_zz');
  chan := (r ->> 'channel_id')::uuid;
  posts := (r ->> 'chat_id')::uuid;
  r := public.publish_pop(chan, pop, video, 'Поп', null, true, 'пост с попом', null);
  post := (r ->> 'message_id')::uuid;
  grp := (public.create_chat(array[c, d], 'Группа A, C и D') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(c);
  perform public.accept_chat_invite(grp);
  insert into public.messages (chat_id, author_id, kind, text) values (grp, c, 'text', 'сообщение C в группе') returning id into m_a;

  perform pg_temp.act_as(b);
  dm := (public.create_chat(array[c], null, null, 'Привет, это заявка') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(c);
  perform public.accept_chat_invite(dm);
  insert into public.messages (chat_id, author_id, kind, text) values (dm, c, 'text', 'привет от C') returning id into m_c;

  -- ============================================== К3.1 — реакция на поп
  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.set_reaction('pop', pop, '❤️');
  e := pg_temp.one(b);
  perform pg_temp.check('К3.1 реакция на поп — одно reaction_set',
    e.kind = 'reaction_set' and e.origin = 'server' and e.subject_type = 'pop' and e.subject_id = pop
      and e.data ->> 'emoji' = '❤️' and (e.data ->> 'valence')::numeric = 1
      and (e.data ->> 'pop_id')::uuid = pop and (e.data ->> 'channel_id')::uuid = chan
      and not (e.data ? 'previous'),
    pg_temp.dump(b));

  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.set_reaction('pop', pop, '🔥');
  e := pg_temp.one(b);
  perform pg_temp.check('замена реакции — reaction_set с прежней',
    e.kind = 'reaction_set' and e.data ->> 'emoji' = '🔥' and e.data ->> 'previous' = '❤️', pg_temp.dump(b));

  -- ============================================ К3.1 — комментарий к попу
  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  cm := public.send_pop_comment(pop, 'класс');
  e := pg_temp.one(b);
  perform pg_temp.check('К3.1 комментарий к попу — одно comment_sent',
    e.kind = 'comment_sent' and e.subject_type = 'pop' and e.subject_id = pop
      and (e.data ->> 'comment_id')::uuid = cm and (e.data ->> 'length')::int = 5
      and e.data ->> 'kind' = 'text' and not (e.data ->> 'reply')::boolean
      and e.data ->> 'audience' = 'visitor' and (e.data ->> 'pop_id')::uuid = pop,
    pg_temp.dump(b));

  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.send_pop_comment(pop, 'и ответ', '[]'::jsonb, null, cm);
  e := pg_temp.one(b);
  perform pg_temp.check('ответ в треде — comment_sent с reply',
    e.kind = 'comment_sent' and (e.data ->> 'reply')::boolean, pg_temp.dump(b));

  -- ========================================== К3.1 — подписка и отписка
  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.subscribe_to_channel(chan, true);
  e := pg_temp.one(b);
  perform pg_temp.check('К3.1 подписка — одно subscribed',
    e.kind = 'subscribed' and e.subject_type = 'channel' and e.subject_id = chan
      and (e.data ->> 'in_chats')::boolean, pg_temp.dump(b));

  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.set_channel_in_chats(chan, false);
  e := pg_temp.one(b);
  perform pg_temp.check('убрал канал из «Чатов» — subscription_changed',
    e.kind = 'subscription_changed' and not (e.data ->> 'in_chats')::boolean, pg_temp.dump(b));

  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.unsubscribe_from_channel(chan);
  e := pg_temp.one(b);
  perform pg_temp.check('К3.1 отписка (строка удалена физически) — одно unsubscribed',
    e.kind = 'unsubscribed' and e.subject_id = chan and (e.data ->> 'held_ms') is not null, pg_temp.dump(b));

  -- ================================== К3.1 — пересылка поста с попом в диалог
  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.forward_messages(dm, posts, array[post]);
  e := pg_temp.one(b);
  perform pg_temp.check('К3.1 пересылка поста с попом — одно forward_sent',
    e.kind = 'forward_sent' and e.subject_type = 'message' and e.subject_id = post
      and (e.data ->> 'pop_id')::uuid = pop and e.data ->> 'to_chat_kind' = 'direct'
      and (e.data ->> 'to_chat_id')::uuid = dm and (e.data ->> 'channel_id')::uuid = chan,
    pg_temp.dump(b));

  -- ======================================= К3.1 — сообщение в диалоге
  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  insert into public.messages (chat_id, author_id, kind, text) values (dm, b, 'text', 'ответ B') returning id into m_b;
  e := pg_temp.one(b);
  perform pg_temp.check('К3.1 сообщение в диалоге — одно message_sent',
    e.kind = 'message_sent' and e.subject_id = m_b and e.data ->> 'chat_kind' = 'direct'
      and e.data ->> 'kind' = 'text' and (e.data ->> 'length')::int = 7 and (e.data ->> 'chat_id')::uuid = dm,
    pg_temp.dump(b));

  -- ===================================== К3.1 — реакция на сообщение
  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.set_reaction('message', m_c, '👍');
  e := pg_temp.one(b);
  perform pg_temp.check('К3.1 реакция на сообщение — одно reaction_set',
    e.kind = 'reaction_set' and e.subject_type = 'message' and e.subject_id = m_c
      and e.data ->> 'audience' = 'member' and (e.data ->> 'chat_id')::uuid = dm, pg_temp.dump(b));

  -- =============================== К3.1 — комментарий к чужому сообщению
  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.send_comment(m_a, 'со стороны');
  e := pg_temp.one(b);
  perform pg_temp.check('К3.1 комментарий к чужому сообщению — одно comment_sent посетителя',
    e.kind = 'comment_sent' and e.subject_type = 'message' and e.subject_id = m_a
      and e.data ->> 'audience' = 'visitor' and (e.data ->> 'chat_id')::uuid = grp, pg_temp.dump(b));

  -- ============================================ просмотры сообщений
  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.record_message_views(dm, array[m_c], gen_random_uuid());
  e := pg_temp.one(b);
  perform pg_temp.check('засчитанный просмотр сообщения — одно message_viewed',
    e.kind = 'message_viewed' and e.subject_id = m_c and (e.data ->> 'first')::boolean, pg_temp.dump(b));

  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.record_message_views(dm, array[m_c], gen_random_uuid());
  perform pg_temp.as_service();
  perform pg_temp.check('просмотр, не засчитанный правилом 10 с, — без события',
    not exists (select 1 from public.rec_events where user_id = b), pg_temp.dump(b));

  -- ================================================ состав и скрытие
  perform pg_temp.forget(c);
  perform pg_temp.act_as(c);
  perform public.leave_chat(grp);
  e := pg_temp.one(c);
  perform pg_temp.check('выход из группы — одно chat_left',
    e.kind = 'chat_left' and e.subject_id = grp and e.data ->> 'chat_kind' = 'group',
    pg_temp.dump(c));

  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.set_pop_not_interested(pop, true);
  e := pg_temp.one(b);
  perform pg_temp.check('«не интересно» — одно pop_not_interested',
    e.kind = 'pop_not_interested' and e.subject_id = pop, pg_temp.dump(b));

  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.set_channel_hidden(chan, true, pop);
  e := pg_temp.one(b);
  perform pg_temp.check('скрыть канал — одно channel_hidden с попом',
    e.kind = 'channel_hidden' and e.subject_id = chan and (e.data ->> 'pop_id')::uuid = pop, pg_temp.dump(b));

  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.subscribe_to_channel(chan, false);
  perform pg_temp.flush();
  perform pg_temp.as_service();
  perform pg_temp.check('подписка на скрытый канал — subscribed и channel_unhidden через подписку',
    (select count(*) from public.rec_events where user_id = b) = 2
      and exists (select 1 from public.rec_events where user_id = b and kind = 'channel_unhidden' and data ->> 'via' = 'subscribe'),
    pg_temp.dump(b));

  -- ========================================== К3.2 — быстрая отмена
  perform pg_temp.act_as(b);
  perform public.set_reaction('message', m_c, '😁');
  perform pg_temp.as_service();
  update public.reactions set updated_at = now() - interval '3 seconds'
  where target_id = m_c and user_id = b and deleted_at is null;
  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.set_reaction('message', m_c, null);
  e := pg_temp.one(b);
  perform pg_temp.check('К3.2 реакция снята через 3 с — быстрая отмена',
    e.kind = 'reaction_removed' and (e.data ->> 'quick')::boolean
      and (e.data ->> 'held_ms')::int between 2900 and 3100 and e.data ->> 'emoji' = '😁',
    pg_temp.dump(b));

  perform pg_temp.act_as(b);
  perform public.set_reaction('message', m_c, '👍');
  perform pg_temp.as_service();
  update public.reactions set updated_at = now() - interval '10 minutes'
  where target_id = m_c and user_id = b and deleted_at is null;
  perform pg_temp.forget(b);
  perform pg_temp.act_as(b);
  perform public.set_reaction('message', m_c, null);
  e := pg_temp.one(b);
  perform pg_temp.check('К3.2 реакция снята через 10 мин — не быстрая',
    e.kind = 'reaction_removed' and not (e.data ->> 'quick')::boolean, pg_temp.dump(b));

  -- ============================== удаление аккаунта не ломается журналом
  perform pg_temp.as_service();
  delete from auth.users where id = b;
  perform pg_temp.check('удаление аккаунта: сырьё уходит каскадом, подписки и участие — без падения',
    not exists (select 1 from public.rec_events where user_id = b)
      and not exists (select 1 from public.subscriptions where subscriber_id = b));
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
