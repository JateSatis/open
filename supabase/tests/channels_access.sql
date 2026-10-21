-- Каналы: кто публикует посты, кто может стать участником чата постов, имена
-- каналов (своё пространство, отдельное от профилей — usernames_access.sql).
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/channels_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000000a9', 'ca@test.local', '{"full_name":"Владелец A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b9', 'cb@test.local', '{"full_name":"Читатель B"}', 'authenticated', 'authenticated');

update public.profiles set username = 'reader_b_zz' where id = '00000000-0000-4000-8000-0000000000b9';

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void language sql as $$
  insert into results (name, ok, detail) values (name, ok, detail);
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a9';
  b uuid := '00000000-0000-4000-8000-0000000000b9';
  r jsonb;
  chat uuid;
  chan uuid;
  msg uuid;
  emo text;
  aud text;
  c uuid;
  dm jsonb;
begin
  select min(emoji) into emo from public.reaction_emojis;

  perform pg_temp.act_as(a);
  r := public.create_channel('Канал A', 'chan_a_zz', 'описание', null);
  chat := (r ->> 'chat_id')::uuid;
  chan := (r ->> 'channel_id')::uuid;

  perform pg_temp.check('владелец — единственный участник чата постов',
    (select array_agg(user_id) from public.chat_members where chat_id = chat) = array[a]);
  perform pg_temp.check('вид чата — channel_posts',
    (select kind from public.chats where id = chat) = 'channel_posts');
  perform pg_temp.check('имя чата постов — название канала',
    (select public.chat_display_name(x) from public.chats x where id = chat) = 'Канал A');

  insert into public.messages (chat_id, author_id, kind, text)
  values (chat, a, 'text', 'первый пост') returning id into msg;
  perform pg_temp.check('владелец публикует пост', msg is not null);

  perform pg_temp.check('имя профиля свободно для канала',
    (public.create_channel('X', 'READER_B_ZZ') ->> 'channel_id') is not null);

  begin
    perform public.create_channel('X', 'Chan_A_ZZ');
    perform pg_temp.check('имя канала занято для канала', false);
  exception when others then
    perform pg_temp.check('имя канала занято для канала', sqlstate = 'OPN02', sqlerrm);
  end;

  begin
    perform public.create_channel('X', 'bad name@');
    perform pg_temp.check('имя с пробелом и @ — отказ', false);
  exception when others then
    perform pg_temp.check('имя с пробелом и @ — отказ', sqlstate = '22023', sqlerrm);
  end;

  perform pg_temp.check('проверка занятости: занято', not public.is_username_available('channel', 'CHAN_a_zz'));
  perform pg_temp.check('проверка занятости: свободно', public.is_username_available('channel', 'free_name_zz'));

  -- Прямого UPDATE чатов у клиента нет (названия — функциями `set_chat_*`);
  -- инвариант «у чата постов нет своего названия» держит CHECK — он
  -- проверяется в обход прав на таблицу.
  begin
    update public.chats set title = 'x' where id = chat;
    perform pg_temp.check('прямой UPDATE чата клиентом — отказ', false);
  exception when others then
    perform pg_temp.check('прямой UPDATE чата клиентом — отказ', sqlstate = '42501', sqlerrm);
  end;

  perform set_config('role', 'postgres', true);
  begin
    update public.chats set title = 'x' where id = chat;
    perform pg_temp.check('у чата постов нет своего названия', false);
  exception when others then
    perform pg_temp.check('у чата постов нет своего названия', sqlstate = '23514', sqlerrm);
  end;
  perform pg_temp.act_as(a);

  -- Прямого DELETE участников нет ни у кого: уходят функцией (`leave_chat`),
  -- а она чат постов не принимает.
  begin
    delete from public.chat_members where chat_id = chat and user_id = a;
  exception when others then null;
  end;
  begin
    perform public.leave_chat(chat);
  exception when others then null;
  end;
  perform pg_temp.check('владелец не уходит из чата постов сам',
    exists (select 1 from public.chat_members where chat_id = chat and user_id = a));

  begin
    perform public.start_call(chat);
    perform pg_temp.check('звонок в канале — отказ', false);
  exception when others then
    perform pg_temp.check('звонок в канале — отказ', sqlstate = '42501', sqlerrm);
  end;

  -- Посторонний
  perform pg_temp.act_as(b);

  begin
    insert into public.messages (chat_id, author_id, kind, text) values (chat, b, 'text', 'чужой пост');
    perform pg_temp.check('посторонний не публикует', false);
  exception when others then
    perform pg_temp.check('посторонний не публикует', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.check('посторонний читает канал',
    exists (select 1 from public.channels where id = chan)
    and exists (select 1 from public.messages where id = msg));

  begin
    insert into public.channels (title, username, posts_chat_id) values ('x', 'hack_zz', chat);
    perform pg_temp.check('прямая запись в channels — отказ', false);
  exception when others then
    perform pg_temp.check('прямая запись в channels — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    insert into public.chat_members (chat_id, user_id) values (chat, b);
    perform pg_temp.check('прямое вступление в чат постов — отказ', false);
  exception when others then
    perform pg_temp.check('прямое вступление в чат постов — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.accept_chat_invite(chat);
    perform pg_temp.check('принять «заявку» в канал — отказ', false);
  exception when others then
    perform pg_temp.check('принять «заявку» в канал — отказ', true, sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.start_call(chat);
    perform pg_temp.check('посторонний не звонит в канал', false);
  exception when others then
    perform pg_temp.check('посторонний не звонит в канал', sqlstate = '42501', sqlerrm);
  end;

  update public.profiles set username = 'Chan_A_ZZ' where id = b;
  perform pg_temp.check('профиль берёт имя канала',
    (select username from public.profiles where id = b) = 'Chan_A_ZZ');
  update public.profiles set username = 'reader_b_zz' where id = b;

  select s.audience into aud from public.set_reaction('message', msg, emo) s;
  perform pg_temp.check('реакция постороннего — visitor', aud = 'visitor', aud);

  c := public.send_comment(msg, 'комментарий со стороны');
  perform pg_temp.check('комментарий постороннего — visitor',
    (select audience from public.comments where id = c) = 'visitor');

  -- Пересылка поста в чат постороннего: островок подписан названием канала.
  perform set_config('role', 'postgres', true);
  insert into public.chats (kind, created_by) values ('group', b) returning jsonb_build_object('id', id) into dm;
  insert into public.chat_members (chat_id, user_id) values ((dm ->> 'id')::uuid, b);
  perform pg_temp.act_as(b);
  perform public.forward_messages((dm ->> 'id')::uuid, chat, array[msg]);
  perform pg_temp.check('пост пересылается, заголовок островка — канал',
    (select public.chat_display_name(x) from public.chats x
     where x.id = (select source_chat_id from public.messages
                   where chat_id = (dm ->> 'id')::uuid and kind = 'forward' limit 1)) = 'Канал A');

  -- Пути в обход функций, даже от имени владельца схемы.
  perform set_config('role', 'postgres', true);

  begin
    insert into public.chat_members (chat_id, user_id) values (chat, b);
    perform pg_temp.check('участника чата постов не добавить мимо функции канала', false);
  exception when others then
    perform pg_temp.check('участника чата постов не добавить мимо функции канала', sqlstate = '42501', sqlerrm);
  end;

  begin
    insert into public.chat_invites (chat_id, inviter_id, invitee_id) values (chat, a, b);
    perform pg_temp.check('заявка в чат постов — отказ', false);
  exception when others then
    perform pg_temp.check('заявка в чат постов — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    insert into public.chats (kind, created_by) values ('channel_posts', a);
    set constraints all immediate;
    perform pg_temp.check('чат постов без канала — отказ', false);
  exception when others then
    perform pg_temp.check('чат постов без канала — отказ', sqlstate = '23514', sqlerrm);
  end;
end;
$$;

-- =============================================================================
-- Попсы
-- =============================================================================

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a9';
  b uuid := '00000000-0000-4000-8000-0000000000b9';
  video jsonb := '{"url":"a9/pops/v.mp4","poster_url":"a9/pops/p.jpg","mime_type":"video/mp4","width":720,"height":1280,"duration_ms":5000}';
  chat uuid;
  chan uuid;
  other_chan uuid;
  r jsonb;
  pop uuid := gen_random_uuid();
  other_pop uuid := gen_random_uuid();
  bare_pop uuid := gen_random_uuid();
  post uuid;
  post2 uuid;
  att uuid;
  emo text;
  aud text;
  c uuid;
begin
  select min(emoji) into emo from public.reaction_emojis;
  perform pg_temp.act_as(a);

  select id, posts_chat_id into chan, chat from public.channels where username = 'chan_a_zz';
  other_chan := (public.create_channel('Канал A2', 'chan_a2_zz') ->> 'channel_id')::uuid;

  perform pg_temp.check('владелец может публиковать', public.can_publish_in_channel(chan));

  r := public.publish_pop(chan, pop, video, 'Поп', ' подпись ', true, 'подпись', null);
  post := (r ->> 'message_id')::uuid;
  perform pg_temp.check('поп с постом: поп и пост созданы',
    (r ->> 'pop_id')::uuid = pop
    and (select caption from public.pops where id = pop) = 'подпись'
    and (select kind || '|' || text from public.messages where id = post) = 'media|подпись'
    and (select pop_id from public.attachments where message_id = post) = pop);

  perform pg_temp.check('превью списка — Pop и текст',
    (select last_message_text from public.chats where id = chat) = '🎬 Pop: подпись');

  r := public.publish_pop(chan, pop, video, 'Поп', 'подпись', true, 'подпись', null);
  perform pg_temp.check('повтор публикации отдаёт созданное, без дублей',
    (r ->> 'message_id')::uuid = post
    and (select count(*) from public.pops where id = pop) = 1
    and (select count(*) from public.attachments where pop_id = pop) = 1);

  r := public.publish_pop(chan, bare_pop, video, 'Поп', null, false, null, null);
  perform pg_temp.check('поп без поста', r -> 'message_id' = 'null'::jsonb
    and not exists (select 1 from public.attachments where pop_id = bare_pop));

  post2 := public.send_pop_post(chat, bare_pop, null, null);
  perform pg_temp.check('пост с существующим попом без текста',
    (select text from public.messages where id = post2) is null
    and (select last_message_text from public.chats where id = chat) = '🎬 Pop');

  perform public.publish_pop(other_chan, other_pop, video, 'Поп', null, false, null, null);

  begin
    perform public.send_pop_post(chat, other_pop, 'чужой', null);
    perform pg_temp.check('поп другого канала — отказ', false);
  exception when others then
    perform pg_temp.check('поп другого канала — отказ', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.check('название попа сохраняется, пост берёт текст подписи, а не название',
    (select title from public.pops where id = pop) = 'Поп'
    and (select text from public.messages where id = post) = 'подпись');

  begin
    perform public.publish_pop(chan, gen_random_uuid(), video, null, 'подпись', false, null, null);
    perform pg_temp.check('поп без названия — отказ', false);
  exception when others then
    perform pg_temp.check('поп без названия — отказ', sqlstate = '23514', sqlerrm);
  end;

  begin
    perform public.publish_pop(chan, gen_random_uuid(), video, '   ', null, false, null, null);
    perform pg_temp.check('поп с пустым названием — отказ', false);
  exception when others then
    perform pg_temp.check('поп с пустым названием — отказ', sqlstate = '23514', sqlerrm);
  end;

  begin
    perform public.publish_pop(chan, gen_random_uuid(), video - 'poster_url', 'Поп', null, false, null, null);
    perform pg_temp.check('поп без постера — отказ', false);
  exception when others then
    perform pg_temp.check('поп без постера — отказ', sqlstate = '23502', sqlerrm);
  end;

  begin
    perform public.publish_pop(chan, gen_random_uuid(), video || '{"mime_type":"image/jpeg"}', 'Поп', null, false, null, null);
    perform pg_temp.check('поп не-видео — отказ', false);
  exception when others then
    perform pg_temp.check('поп не-видео — отказ', sqlstate = '23514', sqlerrm);
  end;

  begin
    insert into public.attachments (message_id, message_kind, url, mime_type, position)
    values (post, 'media', 'a9/x.jpg', 'image/jpeg', 1);
    set constraints all immediate;
    perform pg_temp.check('пост с попом и ещё файлом — отказ', false);
  exception when others then
    perform pg_temp.check('пост с попом и ещё файлом — отказ', sqlstate = '23514', sqlerrm);
  end;

  begin
    insert into public.attachments (message_id, message_kind, pop_id, position)
    values (post, 'media', bare_pop, 1);
    perform pg_temp.check('ссылку на поп не вставить напрямую', false);
  exception when others then
    perform pg_temp.check('ссылку на поп не вставить напрямую', sqlstate = '42501', sqlerrm);
  end;

  select id into att from public.attachments where message_id = post;

  begin
    perform public.edit_message(post, 'без попа', '[]'::jsonb);
    perform pg_temp.check('правка, убирающая поп, — отказ', false);
  exception when others then
    perform pg_temp.check('правка, убирающая поп, — отказ', sqlstate = '23514', sqlerrm);
  end;

  begin
    perform public.edit_message(post, 'замена',
      '[{"url":"a9/x.jpg","mime_type":"image/jpeg","width":10,"height":10}]'::jsonb);
    perform pg_temp.check('правка, заменяющая поп файлом, — отказ', false);
  exception when others then
    perform pg_temp.check('правка, заменяющая поп файлом, — отказ', sqlstate = '23514', sqlerrm);
  end;

  begin
    perform public.edit_message(post, 'добавить',
      jsonb_build_array(jsonb_build_object('attachment_id', att),
        '{"url":"a9/x.jpg","mime_type":"image/jpeg","width":10,"height":10}'::jsonb));
    perform pg_temp.check('правка, добавляющая файл к попу, — отказ', false);
  exception when others then
    perform pg_temp.check('правка, добавляющая файл к попу, — отказ', sqlstate = '23514', sqlerrm);
  end;

  perform public.edit_message(post, 'новый текст', jsonb_build_array(jsonb_build_object('attachment_id', att)));
  perform pg_temp.check('правка текста поста с попом',
    (select text from public.messages where id = post) = 'новый текст'
    and (select pop_id from public.attachments where message_id = post) = pop);

  -- Удалённый поп (этап 3) не замораживает текст поста, который его показывает.
  perform set_config('role', 'postgres', true);
  update public.pops set deleted_at = now() where id = bare_pop;
  perform pg_temp.act_as(a);
  perform public.edit_message(post2, 'после удаления попа',
    jsonb_build_array(jsonb_build_object('attachment_id',
      (select id from public.attachments where message_id = post2))));
  perform pg_temp.check('правка поста с удалённым попом',
    (select text from public.messages where id = post2) = 'после удаления попа');

  begin
    perform public.send_pop_post(chat, bare_pop, 'с удалённым', null);
    perform pg_temp.check('новый пост с удалённым попом — отказ', false);
  exception when others then
    perform pg_temp.check('новый пост с удалённым попом — отказ', sqlstate = '42501', sqlerrm);
  end;

  perform set_config('role', 'postgres', true);
  update public.pops set deleted_at = null where id = bare_pop;

  -- Посторонний
  perform pg_temp.act_as(b);

  perform pg_temp.check('посторонний не может публиковать', not public.can_publish_in_channel(chan));
  perform pg_temp.check('посторонний видит попсы канала',
    (select count(*) from public.pops where channel_id = chan) = 2);

  begin
    perform public.publish_pop(chan, gen_random_uuid(), video, 'Поп', null, true, 'x', null);
    perform pg_temp.check('посторонний: publish_pop — отказ', false);
  exception when others then
    perform pg_temp.check('посторонний: publish_pop — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.send_pop_post(chat, pop, 'x', null);
    perform pg_temp.check('посторонний: send_pop_post — отказ', false);
  exception when others then
    perform pg_temp.check('посторонний: send_pop_post — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    insert into public.pops (channel_id, author_id, url, poster_url, mime_type, width, height, duration_ms)
    values (chan, b, 'b9/v.mp4', 'b9/p.jpg', 'video/mp4', 720, 1280, 1000);
    perform pg_temp.check('посторонний: прямая вставка в pops — отказ', false);
  exception when others then
    perform pg_temp.check('посторонний: прямая вставка в pops — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    insert into public.attachments (message_id, message_kind, pop_id, position)
    values (post, 'media', pop, 1);
    perform pg_temp.check('посторонний: прямая вставка в attachments — отказ', false);
  exception when others then
    perform pg_temp.check('посторонний: прямая вставка в attachments — отказ', sqlstate = '42501', sqlerrm);
  end;

  select s.audience into aud from public.set_reaction('message', post, emo) s;
  perform pg_temp.check('реакция постороннего на пост с попом — visitor', aud = 'visitor', aud);

  c := public.send_comment(post, 'комментарий к посту с попом');
  perform pg_temp.check('комментарий постороннего к посту с попом — visitor',
    (select audience from public.comments where id = c) = 'visitor');

  -- Удаление поста попа не трогает.
  perform pg_temp.act_as(a);
  perform public.delete_messages(array[post]);
  perform pg_temp.check('удаление поста не трогает поп',
    not exists (select 1 from public.messages where id = post)
    and exists (select 1 from public.pops where id = pop and deleted_at is null));
end;
$$;

-- =============================================================================
-- Реакции и просмотры попа
-- =============================================================================

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a9';
  b uuid := '00000000-0000-4000-8000-0000000000b9';
  chan uuid;
  pop uuid;
  emojis text[];
  aud text;
  u uuid;
  i int;
  s uuid := gen_random_uuid();
  p public.pops;
begin
  select array_agg(emoji order by position) into emojis from public.reaction_emojis;
  select id into chan from public.channels where username = 'chan_a_zz';
  select id into pop from public.pops where channel_id = chan and deleted_at is null
  order by created_at limit 1;

  -- Посторонний ставит, меняет, снимает.
  perform pg_temp.act_as(b);

  select x.audience into aud from public.set_reaction('pop', pop, emojis[1]) x;
  select * into p from public.pops where id = pop;
  perform pg_temp.check('реакция постороннего на поп — проходит, ряд visitor',
    aud = 'visitor' and p.reactions = jsonb_build_object(emojis[1], 1) and p.reactions_count = 1,
    aud || ' ' || p.reactions::text);

  perform pg_temp.check('моя реакция на поп в выборке',
    (select r.emoji from public.pops x, public.my_reaction(x) r where x.id = pop) = emojis[1]);

  perform public.set_reaction('pop', pop, emojis[2]);
  select * into p from public.pops where id = pop;
  perform pg_temp.check('другая реакция на поп заменяет прежнюю',
    p.reactions = jsonb_build_object(emojis[2], 1) and p.reactions_count = 1
    and (select count(*) from public.reactions
         where target_type = 'pop' and target_id = pop and user_id = b and deleted_at is null) = 1,
    p.reactions::text);

  perform public.set_reaction('pop', pop, null);
  select * into p from public.pops where id = pop;
  perform pg_temp.check('null снимает реакцию на поп',
    p.reactions = '{}'::jsonb and p.reactions_count = 0, p.reactions::text);

  -- Публикующий в канале — ряд member.
  perform pg_temp.act_as(a);
  select x.audience into aud from public.set_reaction('pop', pop, emojis[1]) x;
  perform pg_temp.check('реакция автора канала на поп — member', aud = 'member', aud);
  perform public.set_reaction('pop', pop, null);

  -- Лимит: 20 разных, 21-я — отказ, как у комментария.
  perform set_config('role', 'postgres', true);
  for i in 1..21 loop
    u := gen_random_uuid();
    insert into auth.users (id, aud, role, email, raw_user_meta_data)
    values (u, 'authenticated', 'authenticated', 'pop-limit-' || i || '@test.local',
            jsonb_build_object('full_name', 'Тест ' || i));

    if i <= 20 then
      insert into public.reactions (target_type, target_id, user_id, emoji)
      values ('pop', pop, u, emojis[i]);
    else
      begin
        insert into public.reactions (target_type, target_id, user_id, emoji)
        values ('pop', pop, u, emojis[21]);
        perform pg_temp.check('21-я разная реакция на поп — отказ', false);
      exception when others then
        perform pg_temp.check('21-я разная реакция на поп — отказ', sqlstate = 'OR001', sqlerrm);
      end;

      insert into public.reactions (target_type, target_id, user_id, emoji)
      values ('pop', pop, u, emojis[1]);
      perform pg_temp.check('реакция из 20 на поп ставится',
        ((select reactions from public.pops where id = pop) ->> emojis[1])::int = 2
        and (select reactions_count from public.pops where id = pop) = 21);
    end if;
  end loop;

  -- Просмотры: первый показ — оба счётчика, повтор раньше 10 секунд — ничего.
  perform pg_temp.act_as(b);
  perform public.record_pop_views(array[pop], s);
  perform public.record_pop_views(array[pop], gen_random_uuid());
  select * into p from public.pops where id = pop;
  perform pg_temp.check('два показа подряд — +1 просмотр, +1 уникальный',
    p.views_count = 1 and p.unique_views_count = 1, p.views_count || '/' || p.unique_views_count);

  perform set_config('role', 'postgres', true);
  update public.pop_views set counted_at = counted_at - interval '11 seconds' where pop_id = pop;
  perform pg_temp.act_as(b);
  perform public.record_pop_views(array[pop], s);
  select * into p from public.pops where id = pop;
  perform pg_temp.check('показ через 10 секунд — +1 просмотр, уникальные те же',
    p.views_count = 2 and p.unique_views_count = 1, p.views_count || '/' || p.unique_views_count);

  perform pg_temp.act_as(a);
  perform public.record_pop_views(array[pop], gen_random_uuid());
  select * into p from public.pops where id = pop;
  perform pg_temp.check('показ автору канала не считается',
    p.views_count = 2 and p.unique_views_count = 1, p.views_count || '/' || p.unique_views_count);

  -- Мимо функций — отказ.
  perform pg_temp.act_as(b);

  begin
    insert into public.pop_views (pop_id, viewer_id, session_id) values (pop, b, s);
    perform pg_temp.check('прямая вставка в pop_views — отказ', false);
  exception when others then
    perform pg_temp.check('прямая вставка в pop_views — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform 1 from public.pop_views limit 1;
    perform pg_temp.check('чтение pop_views — отказ', false);
  exception when others then
    perform pg_temp.check('чтение pop_views — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    update public.pops set views_count = 1000, reactions = '{}'::jsonb where id = pop;
    perform pg_temp.check('прямая правка счётчиков попа — отказ', false);
  exception when others then
    perform pg_temp.check('прямая правка счётчиков попа — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.set_reaction('poop', pop, emojis[1]);
    perform pg_temp.check('неизвестная цель реакции — отказ', false);
  exception when others then
    perform pg_temp.check('неизвестная цель реакции — отказ', sqlstate = '22023', sqlerrm);
  end;

  -- Удалённый поп: ни реакции, ни просмотра.
  perform set_config('role', 'postgres', true);
  update public.pops set deleted_at = now() where id = pop;
  update public.pop_views set counted_at = counted_at - interval '11 seconds' where pop_id = pop;
  perform pg_temp.act_as(b);

  begin
    perform public.set_reaction('pop', pop, emojis[1]);
    perform pg_temp.check('реакция на удалённый поп — отказ', false);
  exception when others then
    perform pg_temp.check('реакция на удалённый поп — отказ', sqlstate = 'P0002', sqlerrm);
  end;

  perform public.record_pop_views(array[pop], gen_random_uuid());
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('просмотр удалённого попа пропускается',
    (select views_count from public.pops where id = pop) = 2);
end;
$$;

-- =============================================================================
-- Комментарии к попу
-- =============================================================================

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a9';
  b uuid := '00000000-0000-4000-8000-0000000000b9';
  video jsonb := '{"url":"a9/pops/v2.mp4","poster_url":"a9/pops/p2.jpg","mime_type":"video/mp4","width":720,"height":1280,"duration_ms":5000}';
  voice jsonb := '{"url":"b9/c/v.m4a","mime_type":"audio/mp4","duration_ms":1500,"waveform":[1,2,3]}';
  chan uuid;
  posts_chat uuid;
  pop uuid := gen_random_uuid();
  other_pop uuid := gen_random_uuid();
  msg uuid;
  msg_comment uuid;
  other_pop_comment uuid;
  c1 uuid;
  v1 uuid;
  r1 uuid;
  own uuid;
  own_chat uuid;
  fwd uuid[];
  x uuid;
  n int;
  emojis text[];
  aud text;
  u uuid;
  i int;
begin
  select array_agg(emoji order by position) into emojis from public.reaction_emojis;
  select id, posts_chat_id into chan, posts_chat from public.channels where username = 'chan_a_zz';

  perform pg_temp.act_as(a);
  perform public.publish_pop(chan, pop, video, 'Поп', null, false, null, null);
  perform public.publish_pop(chan, other_pop, video, 'Поп', null, false, null, null);
  insert into public.messages (chat_id, author_id, kind, text)
  values (posts_chat, a, 'text', 'пост для сверки') returning id into msg;

  -- К1.1: посторонний — комментарий, голосовое, ответ в ветке; ряд visitor.
  perform pg_temp.act_as(b);
  c1 := public.send_pop_comment(pop, 'первый к попу');
  perform pg_temp.check('посторонний: комментарий к попу — visitor, чат постов, без сообщения',
    (select audience || '|' || (chat_id = posts_chat)::text || '|' || coalesce(message_id::text, '∅')
     from public.comments where id = c1) = 'visitor|true|∅');

  v1 := public.send_voice_pop_comment(pop, voice);
  perform pg_temp.check('посторонний: голосовой к попу — visitor',
    (select audience || '|' || kind from public.comments where id = v1) = 'visitor|voice'
    and (select waveform from public.comment_attachments where comment_id = v1) = array[1,2,3]::smallint[]);

  r1 := public.send_pop_comment(pop, 'ответ в ветке', '[]'::jsonb, array[c1]);
  perform pg_temp.check('посторонний: ответ в ветке попа — тред и цитата',
    (select thread_root_id from public.comments where id = r1) = c1
    and (select quoted_id from public.comment_replies where comment_id = r1) = c1
    and (select replies_count from public.comments where id = c1) = 1);

  x := public.send_pop_comment(pop, 'в тред без цитаты', '[]'::jsonb, null, c1);
  perform pg_temp.check('ответ в ветку попа явным корнем',
    (select thread_root_id from public.comments where id = x) = c1);

  perform pg_temp.check('pops.comments_count считает все комментарии попа',
    (select comments_count from public.pops where id = pop) = 4,
    (select comments_count::text from public.pops where id = pop));

  perform pg_temp.check('комментарии попа не трогают счётчик постов',
    (select comments_count from public.messages where id = msg) = 0);

  perform pg_temp.act_as(a);
  own := public.send_pop_comment(pop, 'от автора канала');
  perform pg_temp.check('владелец канала: комментарий к попу — member',
    (select audience from public.comments where id = own) = 'member');

  perform pg_temp.act_as(b);
  select count(*) into n from public.list_comment_thread_roots(pop);
  perform pg_temp.check('верх попа: корни без ответов', n = 3, n::text);
  select count(*) into n from public.list_thread_roots(pop);
  perform pg_temp.check('list_thread_roots сообщения не отдаёт комментарии попа', n = 0, n::text);

  -- К1.2: ветка и цитата не пересекают границу цели.
  msg_comment := public.send_comment(msg, 'комментарий к посту');
  other_pop_comment := public.send_pop_comment(other_pop, 'к другому попу');

  begin
    perform public.send_pop_comment(pop, 'цитата чужого попа', '[]'::jsonb, array[other_pop_comment]);
    perform pg_temp.check('цитата комментария другого попа — отказ', false);
  exception when others then
    perform pg_temp.check('цитата комментария другого попа — отказ', sqlstate = 'P0002', sqlerrm);
  end;

  begin
    perform public.send_pop_comment(pop, 'цитата сообщения', '[]'::jsonb, array[msg_comment]);
    perform pg_temp.check('цитата комментария к сообщению в попе — отказ', false);
  exception when others then
    perform pg_temp.check('цитата комментария к сообщению в попе — отказ', sqlstate = 'P0002', sqlerrm);
  end;

  begin
    perform public.send_comment(msg, 'цитата попа', '[]'::jsonb, array[c1]);
    perform pg_temp.check('цитата комментария попа под сообщением — отказ', false);
  exception when others then
    perform pg_temp.check('цитата комментария попа под сообщением — отказ', sqlstate = 'P0002', sqlerrm);
  end;

  begin
    perform public.send_pop_comment(pop, 'чужой корень', '[]'::jsonb, null, other_pop_comment);
    perform pg_temp.check('ветка с корнем другого попа — отказ', false);
  exception when others then
    perform pg_temp.check('ветка с корнем другого попа — отказ', sqlstate = '22023', sqlerrm);
  end;

  begin
    insert into public.comments (pop_id, author_id, kind, text, thread_root_id)
    values (pop, b, 'text', 'мимо функции', msg_comment);
    perform pg_temp.check('прямая вставка: корень у комментария сообщения — отказ схемы', false);
  exception when others then
    perform pg_temp.check('прямая вставка: корень у комментария сообщения — отказ схемы', sqlstate = '23503', sqlerrm);
  end;

  begin
    insert into public.comments (message_id, chat_id, pop_id, author_id, kind, text)
    values (msg, posts_chat, pop, b, 'text', 'две цели');
    perform pg_temp.check('две цели сразу — отказ', false);
  exception when others then
    perform pg_temp.check('две цели сразу — отказ', sqlstate in ('23514', '23503'), sqlstate || ' ' || sqlerrm);
  end;

  -- Друзья: личка без заявки, писать можно сразу (этап 3 приватности).
  perform set_config('role', 'postgres', true);
  insert into public.friendships (requester_id, addressee_id, status, accepted_at)
  values (a, b, 'accepted', now());
  perform pg_temp.act_as(a);
  own_chat := (public.create_chat(array[b], null) ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);

  insert into public.comments (pop_id, chat_id, author_id, kind, text)
  values (pop, own_chat, b, 'text', 'чат подделан')
  returning id into x;
  perform pg_temp.check('чат комментария к попу ставит база',
    (select chat_id from public.comments where id = x) = posts_chat);

  perform pg_temp.act_as(a);

  select public.forward_comments(own_chat, array[c1]) into fwd;
  perform pg_temp.check('пересылка комментария к попу — сообщение со ссылкой на комментарий',
    cardinality(fwd) = 1
      and (select forwarded_comment_id from public.messages where id = fwd[1]) = c1);

  perform pg_temp.check('пересылка комментария к сообщению — как раньше',
    cardinality(public.forward_comments(own_chat, array[msg_comment])) = 1);

  perform pg_temp.act_as(b);

  -- К1.3: реакции на комментарий к попу — ряд по праву публиковать, лимит общий.
  select s.audience into aud from public.set_reaction('comment', c1, emojis[1]) s;
  perform pg_temp.check('реакция постороннего на комментарий к попу — visitor',
    aud = 'visitor' and (select reactions_count from public.comments where id = c1) = 1, aud);

  perform pg_temp.act_as(a);
  select s.audience into aud from public.set_reaction('comment', c1, emojis[2]) s;
  perform pg_temp.check('реакция владельца на комментарий к попу — member', aud = 'member', aud);

  perform set_config('role', 'postgres', true);
  for i in 3..21 loop
    u := gen_random_uuid();
    insert into auth.users (id, aud, role, email, raw_user_meta_data)
    values (u, 'authenticated', 'authenticated', 'popc-limit-' || i || '@test.local',
            jsonb_build_object('full_name', 'Тест ' || i));

    begin
      insert into public.reactions (target_type, target_id, user_id, emoji)
      values ('comment', c1, u, emojis[i]);

      if i = 21 then
        perform pg_temp.check('21-я разная реакция на комментарий к попу — отказ', false);
      end if;
    exception when others then
      perform pg_temp.check('21-я разная реакция на комментарий к попу — отказ',
        i = 21 and sqlstate = 'OR001', i || ' ' || sqlerrm);
    end;
  end loop;

  -- К1.4: правка и удаление — только своё; счётчик падает.
  perform pg_temp.act_as(a);

  begin
    perform public.edit_comment(c1, 'чужая правка');
    perform pg_temp.check('чужой правит мой комментарий к попу — отказ', false);
  exception when others then
    perform pg_temp.check('чужой правит мой комментарий к попу — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.delete_comment(c1);
    perform pg_temp.check('чужой удаляет мой комментарий к попу — отказ', false);
  exception when others then
    perform pg_temp.check('чужой удаляет мой комментарий к попу — отказ', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.act_as(b);
  perform public.edit_comment(c1, 'первый к попу, правка');
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('правка комментария к попу — ревизия помнит поп',
    (select pop_id from public.comment_revisions where comment_id = c1) = pop
    and (select text from public.comments where id = c1) = 'первый к попу, правка');

  select comments_count into n from public.pops where id = pop;
  perform pg_temp.act_as(b);
  perform public.delete_comment(v1);
  perform pg_temp.check('удаление комментария к попу уменьшает счётчик',
    (select comments_count from public.pops where id = pop) = n - 1);

  -- К1.3: к удалённому попу — ни комментария, ни правки.
  perform set_config('role', 'postgres', true);
  update public.pops set deleted_at = now() where id = pop;
  perform pg_temp.act_as(b);

  begin
    perform public.send_pop_comment(pop, 'к удалённому');
    perform pg_temp.check('комментарий к удалённому попу — отказ', false);
  exception when others then
    perform pg_temp.check('комментарий к удалённому попу — отказ', sqlstate = 'P0002', sqlerrm);
  end;

  begin
    insert into public.comments (pop_id, author_id, kind, text) values (pop, b, 'text', 'мимо функции');
    perform pg_temp.check('прямая вставка к удалённому попу — отказ', false);
  exception when others then
    perform pg_temp.check('прямая вставка к удалённому попу — отказ', sqlstate = 'P0002', sqlerrm);
  end;

  begin
    perform public.edit_comment(c1, 'правка после удаления попа');
    perform pg_temp.check('правка комментария удалённого попа — отказ', false);
  exception when others then
    perform pg_temp.check('правка комментария удалённого попа — отказ', sqlstate = 'P0002', sqlerrm);
  end;

  perform set_config('role', 'postgres', true);
end;
$$;

select n, name, ok, detail from results order by n;

rollback;
