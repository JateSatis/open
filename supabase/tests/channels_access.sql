-- Каналы: кто публикует посты, кто может стать участником чата постов, общее
-- пространство имён профилей и каналов.
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

  begin
    perform public.create_channel('X', 'READER_B_ZZ');
    perform pg_temp.check('имя профиля занято для канала (регистр не важен)', false);
  exception when others then
    perform pg_temp.check('имя профиля занято для канала (регистр не важен)', sqlstate = 'OPN02', sqlerrm);
  end;

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

  perform pg_temp.check('проверка занятости: занято', not public.is_handle_available('CHAN_a_zz'));
  perform pg_temp.check('проверка занятости: свободно', public.is_handle_available('free_name_zz'));

  begin
    update public.chats set title = 'x' where id = chat;
    perform pg_temp.check('у чата постов нет своего названия', false);
  exception when others then
    perform pg_temp.check('у чата постов нет своего названия', sqlstate = '23514', sqlerrm);
  end;

  delete from public.chat_members where chat_id = chat and user_id = a;
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
    insert into public.handles (handle, profile_id) values ('hack_zz', b);
    perform pg_temp.check('прямая запись в handles — отказ', false);
  exception when others then
    perform pg_temp.check('прямая запись в handles — отказ', sqlstate = '42501', sqlerrm);
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

  begin
    update public.profiles set username = 'Chan_A_ZZ' where id = b;
    perform pg_temp.check('профиль не берёт имя канала', false);
  exception when others then
    perform pg_temp.check('профиль не берёт имя канала', sqlstate = '23505', sqlerrm);
  end;

  update public.profiles set username = 'reader_b_zz', display_name = 'B' where id = b;
  perform pg_temp.check('своё прежнее имя сохраняется',
    (select handle from public.handles where profile_id = b) = 'reader_b_zz');

  update public.profiles set username = 'reader_b2_zz' where id = b;
  perform pg_temp.check('смена имени профиля освобождает прежнее',
    public.is_handle_available('reader_b_zz')
    and (select handle from public.handles where profile_id = b) = 'reader_b2_zz');

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

  r := public.publish_pop(chan, pop, video, ' подпись ', true, 'подпись', null);
  post := (r ->> 'message_id')::uuid;
  perform pg_temp.check('поп с постом: поп и пост созданы',
    (r ->> 'pop_id')::uuid = pop
    and (select caption from public.pops where id = pop) = 'подпись'
    and (select kind || '|' || text from public.messages where id = post) = 'media|подпись'
    and (select pop_id from public.attachments where message_id = post) = pop);

  perform pg_temp.check('превью списка — Pop и текст',
    (select last_message_text from public.chats where id = chat) = '🎬 Pop: подпись');

  r := public.publish_pop(chan, pop, video, 'подпись', true, 'подпись', null);
  perform pg_temp.check('повтор публикации отдаёт созданное, без дублей',
    (r ->> 'message_id')::uuid = post
    and (select count(*) from public.pops where id = pop) = 1
    and (select count(*) from public.attachments where pop_id = pop) = 1);

  r := public.publish_pop(chan, bare_pop, video, null, false, null, null);
  perform pg_temp.check('поп без поста', r -> 'message_id' = 'null'::jsonb
    and not exists (select 1 from public.attachments where pop_id = bare_pop));

  post2 := public.send_pop_post(chat, bare_pop, null, null);
  perform pg_temp.check('пост с существующим попом без текста',
    (select text from public.messages where id = post2) is null
    and (select last_message_text from public.chats where id = chat) = '🎬 Pop');

  perform public.publish_pop(other_chan, other_pop, video, null, false, null, null);

  begin
    perform public.send_pop_post(chat, other_pop, 'чужой', null);
    perform pg_temp.check('поп другого канала — отказ', false);
  exception when others then
    perform pg_temp.check('поп другого канала — отказ', sqlstate = '42501', sqlerrm);
  end;

  begin
    perform public.publish_pop(chan, gen_random_uuid(), video - 'poster_url', null, false, null, null);
    perform pg_temp.check('поп без постера — отказ', false);
  exception when others then
    perform pg_temp.check('поп без постера — отказ', sqlstate = '23502', sqlerrm);
  end;

  begin
    perform public.publish_pop(chan, gen_random_uuid(), video || '{"mime_type":"image/jpeg"}', null, false, null, null);
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
    perform public.publish_pop(chan, gen_random_uuid(), video, null, true, 'x', null);
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

select n, name, ok, detail from results order by n;

rollback;
