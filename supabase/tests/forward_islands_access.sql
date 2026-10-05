-- Пересылка островками: кто может, что куда ложится и что нельзя подделать.
--
-- Сценарий — пример из задачи: чат «Джиган и Самойлова», «Хейтеры Джигана»
-- и «Вася и Света». Запуск против облачной базы, ничего не оставляет после
-- себя — всё внутри транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/forward_islands_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.
--
-- Форму сообщения проверяет отложенный триггер в конце транзакции. Транзакция
-- здесь одна на весь файл, поэтому после вставок он запускается
-- принудительно: `set constraints all immediate`, затем обратно в отложенный.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000f1', 'fj@test.local', '{"full_name":"Джиган"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000f2', 'fs@test.local', '{"full_name":"Самойлова"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000f3', 'fh@test.local', '{"full_name":"Админ хейтеров"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000f4', 'fh2@test.local', '{"full_name":"Второй админ"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000f5', 'fv@test.local', '{"full_name":"Вася"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000f6', 'fsv@test.local', '{"full_name":"Света"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000f7', 'fx@test.local', '{"full_name":"Посторонний"}', 'authenticated', 'authenticated');

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

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, ok, detail) $$;

create function pg_temp.say(chat uuid, author uuid, body text, at timestamptz) returns uuid
language plpgsql as $$
declare
  id uuid;
begin
  insert into public.messages (chat_id, author_id, kind, text, created_at)
  values (chat, author, 'text', body, at)
  returning messages.id into id;
  return id;
end;
$$;

do $$
declare
  j uuid := '00000000-0000-4000-8000-0000000000f1';
  sam uuid := '00000000-0000-4000-8000-0000000000f2';
  h1 uuid := '00000000-0000-4000-8000-0000000000f3';
  h2 uuid := '00000000-0000-4000-8000-0000000000f4';
  v uuid := '00000000-0000-4000-8000-0000000000f5';
  sv uuid := '00000000-0000-4000-8000-0000000000f6';
  x uuid := '00000000-0000-4000-8000-0000000000f7';
  chat_js uuid;
  chat_hate uuid;
  chat_vs uuid;
  m1 uuid;
  m2 uuid;
  m3 uuid;
  gone uuid;
  sys uuid;
  hate_msg uuid;
  island1 uuid;
  island2 uuid;
  reply uuid;
  n int;
  s text;
  ok boolean;
  t timestamptz := now() - interval '1 hour';
begin
  -- ------------------------------------------------------------- подготовка
  perform pg_temp.act_as(j);
  chat_js := (public.create_chat(array[sam], 'Джиган и Самойлова') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(h1);
  chat_hate := (public.create_chat(array[h2, v], 'Хейтеры Джигана') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(v);
  chat_vs := (public.create_chat(array[sv], 'Вася и Света') ->> 'chat_id')::uuid;

  perform pg_temp.act_as(sam);
  perform public.accept_chat_invite(chat_js);
  perform pg_temp.act_as(h2);
  perform public.accept_chat_invite(chat_hate);
  perform pg_temp.act_as(v);
  perform public.accept_chat_invite(chat_hate);
  perform pg_temp.act_as(sv);
  perform public.accept_chat_invite(chat_vs);

  perform pg_temp.act_as(j);
  m1 := pg_temp.say(chat_js, j, 'Самойлова, ты дура!', t);
  m3 := pg_temp.say(chat_js, j, 'не пересылалось', t + interval '2 minutes');
  gone := pg_temp.say(chat_js, j, 'будет удалено', t + interval '3 minutes');
  perform public.delete_messages(array[gone]);
  perform pg_temp.act_as(sam);
  m2 := pg_temp.say(chat_js, sam, 'Сам ты дурак, Джиган!', t + interval '1 minute');

  perform set_config('role', 'postgres', true);
  insert into public.messages (chat_id, author_id, kind, text, created_at)
  values (chat_js, null, 'system', 'служебное', t + interval '4 minutes')
  returning id into sys;

  -- ============================================= пересылка: островок
  -- Админ хейтеров — посетитель чата Джигана — пересылает чужую переписку к себе.
  perform pg_temp.act_as(h1);
  island1 := public.forward_messages(chat_hate, chat_js, array[m1, m2]);
  set constraints all immediate;
  set constraints all deferred;

  select kind || '|' || (author_id = h1) || '|' || (chat_id = chat_hate) || '|' || (source_chat_id = chat_js)
    || '|' || coalesce(text, '-')
  into s from public.messages where id = island1;
  perform pg_temp.check('островок: вид, автор, чат, заголовок, без текста', s = 'forward|true|true|true|-', s);

  select string_agg(message_id::text, ',' order by position) = m1::text || ',' || m2::text into ok
  from public.forward_items where forward_id = island1;
  perform pg_temp.check('островок: ссылки на оригиналы по порядку', ok, null);

  select count(*) into n from public.attachments where message_id = island1;
  perform pg_temp.check('островок ничего не копирует', n = 0, n::text);

  select last_message_text into s from public.chats where id = chat_hate;
  perform pg_temp.check('превью: «Переслано: 2 сообщения»', s = 'Переслано: 2 сообщения', s);

  perform pg_temp.act_as(h2);
  hate_msg := pg_temp.say(chat_hate, h2, 'Ну Джиган и конченый придурок!', now() + interval '1 second');

  -- Вася выделяет два сообщения островка и одно обычное и пересылает к Свете.
  perform pg_temp.act_as(v);
  island2 := public.forward_messages(chat_vs, chat_hate, array[m1, m2, hate_msg]);
  set constraints all immediate;
  set constraints all deferred;

  select string_agg(message_id::text, ',' order by position) = m1::text || ',' || m2::text || ',' || hate_msg::text
  into ok from public.forward_items where forward_id = island2;
  perform pg_temp.check('пересылка из островка — ссылка на первоисточник, порядок как на экране', ok, null);

  select source_chat_id = chat_hate into ok from public.messages where id = island2;
  perform pg_temp.check('заголовок — чат, откуда пересылали', ok, null);

  select last_message_text into s from public.chats where id = chat_vs;
  perform pg_temp.check('превью: «Переслано: 3 сообщения»', s = 'Переслано: 3 сообщения', s);

  -- Повторы отсекаются, первое вхождение остаётся.
  reply := public.forward_messages(chat_hate, chat_hate, array[hate_msg, m1, hate_msg]);
  select count(*) || '|' || string_agg(message_id::text, ',' order by position) into s
  from public.forward_items where forward_id = reply;
  perform pg_temp.check('повторы отсекаются', s = '2|' || hate_msg::text || ',' || m1::text, s);

  -- Пересылать можно и в тот же чат.
  perform pg_temp.act_as(j);
  reply := public.forward_messages(chat_js, chat_js, array[m2]);
  perform pg_temp.check('пересылка в тот же чат', reply is not null, null);

  -- ============================================= пересылка: запреты
  perform pg_temp.act_as(x);
  begin
    perform public.forward_messages(chat_hate, chat_js, array[m1]);
    perform pg_temp.check('в чат, где не участник, переслать нельзя', false, 'прошло');
  exception when others then
    perform pg_temp.check('в чат, где не участник, переслать нельзя', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(v);
  begin
    perform public.forward_messages(chat_vs, chat_hate, array[island1]);
    perform pg_temp.check('сам островок не пересылается', false, 'прошло');
  exception when others then
    perform pg_temp.check('сам островок не пересылается', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.forward_messages(chat_vs, chat_js, array[gone]);
    perform pg_temp.check('удалённое переслать нельзя', false, 'прошло');
  exception when others then
    perform pg_temp.check('удалённое переслать нельзя', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.forward_messages(chat_vs, chat_js, array[m1, gone]);
    perform pg_temp.check('пачка с удалённым отвергается целиком', false, 'прошло');
  exception when others then
    perform pg_temp.check('пачка с удалённым отвергается целиком', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.forward_messages(chat_vs, chat_js, array[sys]);
    perform pg_temp.check('системное не пересылается', false, 'прошло');
  exception when others then
    perform pg_temp.check('системное не пересылается', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.forward_messages(chat_vs, chat_js, '{}'::uuid[]);
    perform pg_temp.check('пустую пересылку не создать', false, 'прошло');
  exception when others then
    perform pg_temp.check('пустую пересылку не создать', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as_anon();
  begin
    perform public.forward_messages(chat_vs, chat_js, array[m1]);
    perform pg_temp.check('anon не вызывает forward_messages', false, 'прошло');
  exception when others then
    perform pg_temp.check('anon не вызывает forward_messages', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- ============================================= подделка заголовка
  perform pg_temp.act_as(v);

  -- m3 никогда не было в «Хейтерах» — подписать его «из Хейтеров» нельзя.
  begin
    perform public.forward_messages(chat_vs, chat_hate, array[m3]);
    perform pg_temp.check('подделка: сообщение не из заголовочного чата', false, 'прошло');
  exception when others then
    perform pg_temp.check('подделка: сообщение не из заголовочного чата', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.forward_messages(chat_vs, chat_vs, array[m1, m3]);
    perform pg_temp.check('подделка: островок другого чата не даёт права на заголовок', false, 'прошло');
  exception when others then
    perform pg_temp.check('подделка: островок другого чата не даёт права на заголовок', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Позиции прямой вставкой не дописать.
  begin
    insert into public.forward_items (chat_id, forward_id, message_id, position)
    values (chat_vs, island2, m3, 50);
    perform pg_temp.check('подделка: позицию прямой вставкой не дописать', false, 'прошло');
  exception when others then
    perform pg_temp.check('подделка: позицию прямой вставкой не дописать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  begin
    update public.forward_items set message_id = m3 where forward_id = island2;
    get diagnostics n = row_count;
    perform pg_temp.check('подделка: ссылку позиции не переписать', n = 0, n::text);
  exception when others then
    perform pg_temp.check('подделка: ссылку позиции не переписать', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- Островок прямо в messages участник не вставит: служебные виды создают
  -- только функции.
  begin
    insert into public.messages (chat_id, author_id, kind, source_chat_id)
    values (chat_vs, v, 'forward', chat_js);
    perform pg_temp.check('подделка: островок прямой вставкой', false, 'прошло');
  exception when others then
    perform pg_temp.check('подделка: островок прямой вставкой', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- И в обход RLS пустой островок база не примет — это схема.
  perform set_config('role', 'postgres', true);
  begin
    insert into public.messages (chat_id, author_id, kind, source_chat_id)
    values (chat_vs, v, 'forward', chat_js);
    set constraints all immediate;
    perform pg_temp.check('подделка: островок без позиций не сохраняется', false, 'прошло');
  exception when others then
    perform pg_temp.check('подделка: островок без позиций не сохраняется', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;
  set constraints all deferred;

  -- Та же проверка без RLS — позиция обычного сообщения не бывает: схема.
  perform set_config('role', 'postgres', true);
  begin
    insert into public.forward_items (chat_id, forward_id, message_id, position)
    values (chat_hate, hate_msg, m3, 0);
    perform pg_temp.check('схема: позиция только у островка', false, 'прошло');
  exception when others then
    perform pg_temp.check('схема: позиция только у островка', sqlstate = '23503', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.forward_items (chat_id, forward_id, message_id, position)
    values (chat_js, island2, m3, 60);
    perform pg_temp.check('схема: позиция в чате своего островка', false, 'прошло');
  exception when others then
    perform pg_temp.check('схема: позиция в чате своего островка', sqlstate = '23503', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.forward_items (chat_id, forward_id, message_id, position)
    values (chat_vs, island2, island1, 61);
    perform pg_temp.check('схема: ссылка на ссылку не допускается', false, 'прошло');
  exception when others then
    perform pg_temp.check('схема: ссылка на ссылку не допускается', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  -- ============================================= островок — не сообщение
  perform pg_temp.act_as(sv);
  begin
    perform public.set_reaction('message', island2, '👍');
    perform pg_temp.check('реакция на островок отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('реакция на островок отвергается', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.reactions (target_type, target_id, user_id, emoji)
    values ('message', island2, sv, '👍');
    perform pg_temp.check('реакция на островок прямой вставкой отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('реакция на островок прямой вставкой отвергается', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_comment(island2, 'коммент к островку');
    perform pg_temp.check('комментарий к островку отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('комментарий к островку отвергается', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.send_media_message(chat_vs, 'цитирую островок', '[]'::jsonb, array[island2]);
    perform pg_temp.check('островок не цитируется', false, 'прошло');
  exception when others then
    perform pg_temp.check('островок не цитируется', sqlstate in ('22023', 'P0002'), sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.pin_message(island2);
    perform pg_temp.check('островок целиком не закрепляется', false, 'прошло');
  exception when others then
    perform pg_temp.check('островок целиком не закрепляется', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
  end;

  -- ============================================= реакция и комментарий — на оригинал
  -- Вася не участник чата Джигана: реакция из островка — в ряду посетителей.
  perform pg_temp.act_as(v);
  select audience into s from public.set_reaction('message', m1, '🔥');
  perform pg_temp.check('реакция из островка — на оригинал, ряд по его чату', s = 'visitor', s);

  perform pg_temp.act_as(j);
  perform public.set_reaction('message', m1, '🔥');

  select coalesce((visitor_reactions ->> '🔥')::int, 0) || '|' || coalesce((member_reactions ->> '🔥')::int, 0)
    || '|' || reactions_count
  into s from public.messages where id = m1;
  perform pg_temp.check('счётчики оригинала: посетитель + участник', s = '1|1|2', s);

  perform pg_temp.act_as(sv);
  perform public.send_comment(m1, 'коммент из островка');
  select comments_count into n from public.messages where id = m1;
  perform pg_temp.check('комментарий из островка — к оригиналу', n = 1, n::text);

  select audience into s from public.comments where message_id = m1;
  perform pg_temp.check('комментатор из чужого чата — посетитель', s = 'visitor', s);

  -- ============================================= ответ на сообщение островка
  perform pg_temp.act_as(sv);
  reply := public.send_media_message(chat_vs, 'ответ на Джигана', '[]'::jsonb, array[m1]);
  select count(*) into n from public.message_replies
  where message_id = reply and quoted_id = m1 and quoted_forward_id = island2;
  perform pg_temp.check('ответ цитирует оригинал и помнит островок', n = 1, n::text);

  begin
    perform public.send_media_message(chat_vs, 'цитирую чужое', '[]'::jsonb, array[m3]);
    perform pg_temp.check('цитата не из этого чата и не из его островка отвергается', false, 'прошло');
  exception when others then
    perform pg_temp.check('цитата не из этого чата и не из его островка отвергается', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
  end;

  -- ============================================= закреп облачка островка
  perform public.pin_message(m1, island2);
  select count(*) into n from public.message_pins
  where chat_id = chat_vs and message_id = m1 and forward_id = island2 and deleted_at is null;
  perform pg_temp.check('облачко островка закрепляется в чате островка', n = 1, n::text);

  perform pg_temp.act_as(x);
  begin
    perform public.pin_message(m1, island2);
    perform pg_temp.check('посторонний не закрепляет в чужом чате', false, 'прошло');
  exception when others then
    perform pg_temp.check('посторонний не закрепляет в чужом чате', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- ============================================= правка и удаление оригинала
  perform pg_temp.act_as(j);
  perform public.edit_message(m1, 'Самойлова, ты дура! (изм.)');
  perform pg_temp.act_as(sv);
  select o.text into s
  from public.forward_items i join public.messages o on o.id = i.message_id
  where i.forward_id = island2 and i.position = 0;
  perform pg_temp.check('правка оригинала видна в островке', s = 'Самойлова, ты дура! (изм.)', s);

  perform pg_temp.act_as(sam);
  perform public.delete_messages(array[m2]);
  perform pg_temp.act_as(sv);
  select count(*) into n from public.forward_items where forward_id = island2;
  perform pg_temp.check('удалённый оригинал: позиция на месте', n = 3, n::text);
  select count(*) into n
  from public.forward_items i join public.messages o on o.id = i.message_id
  where i.forward_id = island2;
  perform pg_temp.check('удалённый оригинал: содержимое не отдаётся', n = 2, n::text);

  -- ============================================= убрать из островка
  begin
    perform public.remove_forward_items(island2, array[m1]);
    perform pg_temp.check('чужой островок не меняется', false, 'прошло');
  exception when others then
    perform pg_temp.check('чужой островок не меняется', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  perform pg_temp.act_as(v);
  perform public.remove_forward_items(island2, array[m1]);
  select count(*) into n from public.forward_items where forward_id = island2;
  perform pg_temp.check('переславший убирает облачко из островка', n = 2, n::text);

  select count(*) into n from public.messages where id = m1 and deleted_at is null;
  perform pg_temp.check('оригинал убранного облачка жив', n = 1, n::text);

  select count(*) into n from public.message_pins
  where chat_id = chat_vs and message_id = m1 and deleted_at is null;
  perform pg_temp.check('закреп убранного облачка снят', n = 0, n::text);

  perform set_config('role', 'postgres', true);
  select public.message_preview_text(m) into s from public.messages m where m.id = island2;
  perform pg_temp.check('превью: число в островке пересчитано', s = 'Переслано: 2 сообщения', s);
  perform pg_temp.act_as(v);

  perform public.remove_forward_items(island2, array[m2, hate_msg]);
  select count(*) into n from public.messages where id = island2;
  perform pg_temp.check('убрано последнее — островок удалён', n = 0, n::text);

  perform set_config('role', 'postgres', true);
  select count(*) into n from public.messages where id = island2 and deleted_at is not null;
  perform pg_temp.check('островок удалён мягко', n = 1, n::text);

  -- Островок целиком удаляет автор — функцией удаления сообщений.
  perform pg_temp.act_as(h1);
  perform public.delete_messages(array[island1]);
  perform pg_temp.act_as(v);
  select count(*) into n from public.messages where id in (island1, m1) and deleted_at is null;
  perform pg_temp.check('островок удалён целиком, оригинал жив', n = 1, n::text);

  -- ============================================= перенос старых копий
  perform set_config('role', 'postgres', true);

  select count(*) into n from public.legacy_forward_copies
  where (note is null) <> (forward_item_id is not null);
  perform pg_temp.check('каждая старая копия перенесена или объяснена', n = 0, n::text);

  select count(*) - count(distinct copy_id) into n from public.legacy_forward_copies;
  perform pg_temp.check('каждая старая копия учтена один раз', n = 0, n::text);

  select count(*) into n
  from public.legacy_forward_copies l
  join public.messages c on c.id = l.copy_id
  where l.forward_item_id is not null and c.deleted_at is null;
  perform pg_temp.check('перенесённые копии скрыты, а не стёрты', n = 0, n::text);

  select count(*) into n
  from public.legacy_forward_copies l
  join public.forward_items i on i.id = l.forward_item_id
  join public.messages f on f.id = i.forward_id
  join public.messages c on c.id = l.copy_id
  where f.kind <> 'forward' or f.chat_id <> c.chat_id or f.author_id is distinct from c.author_id;
  perform pg_temp.check('островок перенесённой копии — в её чате и от её автора', n = 0, n::text);

  perform pg_temp.act_as(v);
  begin
    select count(*) into n from public.legacy_forward_copies;
    perform pg_temp.check('журнал переноса пользователю закрыт', false, n::text);
  exception when others then
    perform pg_temp.check('журнал переноса пользователю закрыт', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
