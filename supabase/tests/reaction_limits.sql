-- Лимит разных реакций и поставившие (миграция
-- 20261007120000_reaction_limits_and_reactors.sql): у сообщения не больше 20
-- разных реакций участников и 7 зрителей, у комментария — 20 в обоих рядах
-- вместе; место освобождается, когда ключ исчез из счётчиков.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/reaction_limits.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (step int, name text, ok boolean, detail text);
create temp table people (n int, id uuid);

-- Задержка публикации для зрителей (этап 6) у защитных настроек включена — здесь проверяется не она.
update public.privacy_settings set public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like '%@test.local');

do $$
declare
  u uuid;
  chat uuid := gen_random_uuid();
  msg uuid;
  com uuid;
  emojis text[];
  i int;
begin
  select array_agg(emoji order by position) into emojis from public.reaction_emojis;

  for i in 1..32 loop
    u := gen_random_uuid();
    insert into auth.users (id, aud, role, email, raw_user_meta_data)
    values (u, 'authenticated', 'authenticated', 'limits-' || i || '@test.local',
            jsonb_build_object('full_name', 'Тест ' || i));
    insert into people values (i, u);
  end loop;

  -- Задержка публикации (этап 6) у защитных настроек включена — здесь не она.
  update public.privacy_settings set public_message_visibility_delay = 'off'
  where user_id in (select id from people);

  insert into public.chats (id, kind) values (chat, 'group');
  -- 1..22 — участники, 23..32 — посетители.
  insert into public.chat_members (chat_id, user_id) select chat, id from people where n <= 22;
  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, (select id from people where n = 1), 'text', 'лимиты') returning id into msg;

  -- К1.1: 20 разных от участников.
  for i in 1..20 loop
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('message', msg, (select id from people where n = i), emojis[i]);
  end loop;

  begin
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('message', msg, (select id from people where n = 21), emojis[21]);
    insert into results values (1, '21-я разная реакция участника отвергнута', false, 'прошла');
  exception when sqlstate 'OR001' then
    insert into results values (1, '21-я разная реакция участника отвергнута', true, sqlerrm);
  end;

  insert into public.reactions (target_type, target_id, user_id, emoji)
  values ('message', msg, (select id from people where n = 21), emojis[1]);
  insert into results values (2, 'реакция из 20 ставится',
    ((select member_reactions from public.messages where id = msg) ->> emojis[1])::int = 2, null);

  -- Единственный у своей реакции меняет её на новую — место освобождается тем же движением.
  update public.reactions set emoji = emojis[22]
  where target_id = msg and user_id = (select id from people where n = 2);
  insert into results values (3, 'смена единственной на новую в полном ряду',
    (select member_reactions ? emojis[22] and not member_reactions ? emojis[2]
     from public.messages where id = msg), null);

  -- К1.3: все сняли одну — новая разная проходит.
  update public.reactions set deleted_at = now()
  where target_id = msg and user_id = (select id from people where n = 3);
  insert into public.reactions (target_type, target_id, user_id, emoji)
  values ('message', msg, (select id from people where n = 22), emojis[23]);
  insert into results values (4, 'место освободилось — новая разная проходит',
    (select member_reactions ? emojis[23] from public.messages where id = msg), null);

  -- К1.2: 7 разных у зрителей.
  for i in 23..29 loop
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('message', msg, (select id from people where n = i), emojis[i + 10]);
  end loop;

  begin
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('message', msg, (select id from people where n = 30), emojis[50]);
    insert into results values (5, '8-я разная реакция зрителя отвергнута', false, 'прошла');
  exception when sqlstate 'OR001' then
    insert into results values (5, '8-я разная реакция зрителя отвергнута', true, sqlerrm);
  end;

  insert into public.reactions (target_type, target_id, user_id, emoji)
  values ('message', msg, (select id from people where n = 30), emojis[33]);
  insert into results values (6, 'реакция из 7 у зрителя ставится',
    ((select visitor_reactions from public.messages where id = msg) ->> emojis[33])::int = 2, null);

  -- Тот же отказ через set_reaction от имени посетителя.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from people where n = 31), 'role', 'authenticated')::text, true);
  begin
    perform * from public.set_reaction('message', msg, emojis[51]);
    insert into results values (7, 'set_reaction: 8-я зрителя отвергнута', false, 'прошла');
  exception when sqlstate 'OR001' then
    insert into results values (7, 'set_reaction: 8-я зрителя отвергнута', true, sqlerrm);
  end;

  -- Поставившие у сообщения — только участники, у эмодзи с одним-двумя.
  insert into results
  select 8, 'reactors сообщения — участники при ≤2 поставивших',
    bool_and(audience = 'member') and count(*) = 21, count(*)::text
  from public.reactors((select m from public.message_rows m where id = msg));

  -- К1.4: комментарий — 20 разных суммарно по обоим рядам.
  insert into public.comments (message_id, chat_id, author_id, kind, text)
  values (msg, chat, (select id from people where n = 1), 'text', 'к') returning id into com;

  for i in 1..10 loop
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('comment', com, (select id from people where n = i), emojis[i]);
  end loop;

  for i in 23..32 loop
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('comment', com, (select id from people where n = i), emojis[i]);
  end loop;

  begin
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('comment', com, (select id from people where n = 11), emojis[60]);
    insert into results values (9, '21-я разная на комментарий отвергнута', false, 'прошла');
  exception when sqlstate 'OR001' then
    insert into results values (9, '21-я разная на комментарий отвергнута', true, sqlerrm);
  end;

  insert into public.reactions (target_type, target_id, user_id, emoji)
  values ('comment', com, (select id from people where n = 11), emojis[23]);
  insert into results
  select 10, 'reactors комментария — оба ряда', count(*) = 21, count(*)::text
  from public.reactors((select c from public.comment_rows c where id = com));
end;
$$;

select * from results order by step;

rollback;
