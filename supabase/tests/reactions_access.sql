-- Реакции: кто может ставить, в какой ряд попадает реакция, что закрыто и
-- верны ли счётчики.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/reactions_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a5', 'ra@test.local', '{"full_name":"Участник A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b5', 'rb@test.local', '{"full_name":"Участник B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c5', 'rc@test.local', '{"full_name":"Приглашённый C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d5', 'rd@test.local', '{"full_name":"Посетитель D"}', 'authenticated', 'authenticated');

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

-- Счётчики сообщения одной строкой: «участники | посетители | всего».
create function pg_temp.counts(msg uuid) returns text language sql as $$
  select member_reactions::text || ' | ' || visitor_reactions::text || ' | ' || reactions_count
  from public.messages where id = msg
$$;

-- Счётчики, пересчитанные заново из таблицы реакций, — в той же форме.
create function pg_temp.recount(msg uuid) returns text language sql as $$
  select
    coalesce((select jsonb_object_agg(emoji, n) from (
      select emoji, count(*) as n from public.reactions
      where target_type = 'message' and target_id = msg and deleted_at is null and audience = 'member'
      group by emoji) m), '{}'::jsonb)::text
    || ' | ' ||
    coalesce((select jsonb_object_agg(emoji, n) from (
      select emoji, count(*) as n from public.reactions
      where target_type = 'message' and target_id = msg and deleted_at is null and audience = 'visitor'
      group by emoji) v), '{}'::jsonb)::text
    || ' | ' ||
    (select count(*) from public.reactions
     where target_type = 'message' and target_id = msg and deleted_at is null)
$$;

-- Моя реакция на сообщение: «ряд:реакция» или пусто.
create function pg_temp.mine(msg uuid) returns text language sql as $$
  select coalesce(
    (select r.audience || ':' || r.emoji from public.messages m, public.my_reaction(m) r where m.id = msg),
    ''
  )
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a5';
  b uuid := '00000000-0000-4000-8000-0000000000b5';
  c uuid := '00000000-0000-4000-8000-0000000000c5';
  d uuid := '00000000-0000-4000-8000-0000000000d5';
  chat uuid;
  ma uuid;
  mb uuid;
  gone uuid;
  n int;
  s text;
  row_id uuid;
  row_id2 uuid;
begin
  -- ------------------------------------------------------------- подготовка
  -- A звал B и C; B принял, C ещё нет. D в чат не звали.
  perform pg_temp.act_as(a);
  chat := (public.create_chat(array[b, c], null) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform public.accept_chat_invite(chat);

  perform pg_temp.act_as(a);
  ma := pg_temp.say(chat, a, 'от A');
  gone := pg_temp.say(chat, a, 'будет удалено');
  perform pg_temp.act_as(b);
  mb := pg_temp.say(chat, b, 'от B');
  perform pg_temp.act_as(a);
  perform public.delete_messages(array[gone]);

  -- ===================================== посетитель ставит в любом чате
  perform pg_temp.act_as(d);
  select audience into s from public.set_reaction('message', ma, '👍');
  perform pg_temp.check('посетитель ставит реакцию в чужом чате', s = 'visitor', s);
  s := pg_temp.counts(ma);
  perform pg_temp.check('реакция посетителя — в ряду посетителей', s = '{} | {"👍": 1} | 1', s);
  s := pg_temp.mine(ma);
  perform pg_temp.check('посетитель видит свою реакцию', s = 'visitor:👍', s);

  -- ============================================= подделка ряда
  insert into public.reactions (target_type, target_id, user_id, emoji, audience)
  values ('message', mb, d, '🔥', 'member')
  returning id into row_id;
  select audience into s from public.reactions where id = row_id;
  perform pg_temp.check('посетитель, объявивший себя участником, — всё равно посетитель', s = 'visitor', s);
  s := pg_temp.counts(mb);
  perform pg_temp.check('поддельный ряд не попал в счётчик участников', s = '{} | {"🔥": 1} | 1', s);

  perform pg_temp.act_as(c);
  insert into public.reactions (target_type, target_id, user_id, emoji, chat_id)
  values ('message', ma, c, '😁', gen_random_uuid())
  returning id into row_id2;
  perform pg_temp.as_service();
  select chat_id::text into s from public.reactions where id = row_id2;
  perform pg_temp.check('чат реакции ставит база, а не запрос', s = chat::text, s);
  delete from public.reactions where id = row_id2;

  -- ================================================= ряды по участию
  perform pg_temp.act_as(b);
  select audience into s from public.set_reaction('message', ma, '🔥');
  perform pg_temp.check('участник — в ряду участников', s = 'member', s);

  perform pg_temp.act_as(c);
  select audience into s from public.set_reaction('message', ma, '❤️');
  perform pg_temp.check('приглашённый, не принявший заявку, — посетитель', s = 'visitor', s);

  perform pg_temp.act_as(a);
  select audience into s from public.set_reaction('message', ma, '👍');
  perform pg_temp.check('на своё сообщение реакцию поставить можно', s = 'member', s);

  s := pg_temp.counts(ma);
  perform pg_temp.check(
    'счётчики по рядам после постановки',
    s = '{"👍": 1, "🔥": 1} | {"👍": 1, "❤️": 1} | 4',
    s
  );

  -- ============================================ замена, повтор, снятие
  perform pg_temp.act_as(b);
  perform public.set_reaction('message', ma, '👍');
  s := pg_temp.counts(ma);
  perform pg_temp.check('вторая реакция заменяет первую', s = '{"👍": 2} | {"👍": 1, "❤️": 1} | 4', s);

  perform public.set_reaction('message', ma, '👍');
  s := pg_temp.counts(ma);
  perform pg_temp.check('повтор той же реакции ничего не меняет', s = '{"👍": 2} | {"👍": 1, "❤️": 1} | 4', s);

  select count(*) into n from public.reactions
  where target_id = ma and user_id = b and deleted_at is null;
  perform pg_temp.check('живая реакция у человека одна', n = 1, n::text);

  select count(*) into n from public.set_reaction('message', ma, null);
  s := pg_temp.counts(ma);
  perform pg_temp.check('снятие убирает из счётчика', s = '{"👍": 1} | {"👍": 1, "❤️": 1} | 3', s);
  perform pg_temp.check('снятие отвечает пустым результатом', n = 0, n::text);
  s := pg_temp.mine(ma);
  perform pg_temp.check('снятая — больше не моя', s = '', s);

  perform pg_temp.as_service();
  select count(*) into n from public.reactions
  where target_id = ma and user_id = b and deleted_at is not null;
  perform pg_temp.check('снятие мягкое: строка осталась с deleted_at', n = 1, n::text);
  perform pg_temp.act_as(b);

  select count(*) into n from public.set_reaction('message', ma, null);
  perform pg_temp.check('снять уже снятую — не ошибка', n = 0, n::text);

  perform public.set_reaction('message', ma, '🔥');
  perform pg_temp.as_service();
  select count(*) into n from public.reactions where target_id = ma and user_id = b;
  perform pg_temp.check('поставленная снова оживляет ту же строку', n = 1, n::text);
  perform pg_temp.act_as(b);

  begin
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('message', ma, b, '😁');
    perform pg_temp.check('вторая живая реакция прямой вставкой отвергнута', false, 'прошла');
  exception when others then
    perform pg_temp.check('вторая живая реакция прямой вставкой отвергнута', sqlstate = '23505', sqlstate || ' ' || sqlerrm);
  end;

  -- ================================================ чужая реакция
  perform pg_temp.act_as(d);

  begin
    update public.reactions set emoji = '💩' where target_id = ma and user_id = b;
    perform pg_temp.check('чужую реакцию не поменять напрямую', false, 'прошло');
  exception when others then
    perform pg_temp.check('чужую реакцию не поменять напрямую', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.reactions set deleted_at = now() where target_id = ma and user_id = b;
    perform pg_temp.check('чужую реакцию не снять напрямую', false, 'прошло');
  exception when others then
    perform pg_temp.check('чужую реакцию не снять напрямую', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    delete from public.reactions where target_id = ma and user_id = b;
    perform pg_temp.check('чужую реакцию не удалить', false, 'прошло');
  exception when others then
    perform pg_temp.check('чужую реакцию не удалить', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('message', mb, b, '💩');
    perform pg_temp.check('реакцию от чужого имени не поставить', false, 'прошло');
  exception when others then
    perform pg_temp.check('реакцию от чужого имени не поставить', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform public.set_reaction('message', ma, '🔥');
  perform pg_temp.as_service();
  select emoji || ':' || coalesce(deleted_at::text, 'жива') into s
  from public.reactions where target_id = ma and user_id = b;
  perform pg_temp.check('своя смена не трогает чужую реакцию', s = '🔥:жива', s);

  perform pg_temp.act_as(d);
  s := pg_temp.counts(ma);
  perform pg_temp.check('счётчики после смены посетителя', s = '{"👍": 1, "🔥": 1} | {"🔥": 1, "❤️": 1} | 4', s);

  -- Счётчики на сообщении клиент не пишет.
  begin
    update public.messages set member_reactions = '{"💩": 100}'::jsonb where id = ma;
    perform pg_temp.check('счётчики не подделать', false, 'прошло');
  exception when others then
    perform pg_temp.check('счётчики не подделать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- ========================================== набор и живость цели
  begin
    perform public.set_reaction('message', mb, 'купите слона');
    perform pg_temp.check('реакция не из набора отвергнута', false, 'прошла');
  exception when others then
    perform pg_temp.check('реакция не из набора отвергнута', sqlstate = '23503', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(c);

  begin
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('message', mb, c, 'X');
    perform pg_temp.check('реакция не из набора прямой вставкой отвергнута', false, 'прошла');
  exception when others then
    perform pg_temp.check('реакция не из набора прямой вставкой отвергнута', sqlstate = '23503', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(d);

  begin
    perform public.set_reaction('message', gone, '👍');
    perform pg_temp.check('на удалённое сообщение реакцию не поставить', false, 'прошла');
  exception when others then
    perform pg_temp.check('на удалённое сообщение реакцию не поставить', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('message', gone, d, '👍');
    perform pg_temp.check('на удалённое прямой вставкой не поставить', false, 'прошла');
  exception when others then
    perform pg_temp.check('на удалённое прямой вставкой не поставить', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.set_reaction('message', gen_random_uuid(), '👍');
    perform pg_temp.check('на несуществующее сообщение реакцию не поставить', false, 'прошла');
  exception when others then
    perform pg_temp.check('на несуществующее сообщение реакцию не поставить', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('message', gen_random_uuid(), d, '👍');
    perform pg_temp.check('на несуществующее прямой вставкой не поставить', false, 'прошла');
  exception when others then
    perform pg_temp.check('на несуществующее прямой вставкой не поставить', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    -- Реакции на комментарии принимаются с 20261003100000; id сообщения
    -- комментарием не прикинуть.
    perform public.set_reaction('comment', ma, '👍');
    perform pg_temp.check('id сообщения не выдать за комментарий', false, 'прошла');
  exception when others then
    perform pg_temp.check('id сообщения не выдать за комментарий', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.set_reaction('post', ma, '👍');
    perform pg_temp.check('неизвестный вид цели отвергнут', false, 'прошла');
  exception when others then
    perform pg_temp.check('неизвестный вид цели отвергнут', sqlstate in ('22023', '23514'), sqlstate || ' ' || sqlerrm);
  end;

  -- ================================================ смена ряда
  -- C принял заявку: его реакция, поставленная посетителем, остаётся в ряду
  -- посетителей, пока он её не поменяет.
  perform pg_temp.act_as(c);
  perform public.accept_chat_invite(chat);
  s := pg_temp.mine(ma);
  perform pg_temp.check('ставший участником — реакция осталась в посетителях', s = 'visitor:❤️', s);

  select audience into s from public.set_reaction('message', ma, '😁');
  perform pg_temp.check('при смене ряд определяется заново', s = 'member', s);
  s := pg_temp.counts(ma);
  perform pg_temp.check(
    'счётчики после смены ряда',
    s = '{"👍": 1, "🔥": 1, "😁": 1} | {"🔥": 1} | 4',
    s
  );

  -- И обратно: B вышел из чата — его реакция остаётся в участниках до смены.
  perform pg_temp.as_service();
  delete from public.chat_members where chat_id = chat and user_id = b;
  perform pg_temp.act_as(b);
  s := pg_temp.mine(ma);
  perform pg_temp.check('вышедший — реакция осталась в участниках', s = 'member:🔥', s);

  select audience into s from public.set_reaction('message', ma, '👎');
  perform pg_temp.check('вышедший поменял реакцию — он посетитель', s = 'visitor', s);
  s := pg_temp.counts(ma);
  perform pg_temp.check(
    'счётчики после обратной смены ряда',
    s = '{"👍": 1, "😁": 1} | {"👎": 1, "🔥": 1} | 4',
    s
  );

  -- Снятая посетителем и поставленная участником — ряд тоже заново.
  perform public.set_reaction('message', ma, null);
  perform pg_temp.as_service();
  insert into public.chat_members (chat_id, user_id) values (chat, b);
  perform pg_temp.act_as(b);
  select audience into s from public.set_reaction('message', ma, '👎');
  perform pg_temp.check('ожившая реакция — ряд по участию сейчас', s = 'member', s);

  -- ================================================ чтение
  perform pg_temp.act_as(d);
  select count(*) into n from public.reactions where target_id = ma;
  perform pg_temp.check('реакции видны всем', n = 4, n::text);

  s := pg_temp.mine(ma);
  perform pg_temp.check('моя реакция — только моя', s = 'visitor:🔥', s);

  perform pg_temp.act_as_anon();

  begin
    perform public.set_reaction('message', ma, '👍');
    perform pg_temp.check('без входа реакцию не поставить', false, 'прошла');
  exception when others then
    perform pg_temp.check('без входа реакцию не поставить', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- ================================================ сверка
  perform pg_temp.as_service();
  perform pg_temp.check('счётчики A сходятся с таблицей', pg_temp.counts(ma) = pg_temp.recount(ma), pg_temp.counts(ma) || ' / ' || pg_temp.recount(ma));
  perform pg_temp.check('счётчики B сходятся с таблицей', pg_temp.counts(mb) = pg_temp.recount(mb), pg_temp.counts(mb) || ' / ' || pg_temp.recount(mb));

  select count(*) into n from public.reaction_emojis where is_primary;
  perform pg_temp.check('основных реакций семь', n = 7, n::text);
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
