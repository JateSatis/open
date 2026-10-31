-- Треды в чатах: корни ответов, сводки плашек, тред и заглушки удалённых
-- корней — глазами смотрящего.
--
-- A, B, C — участники группы, V — посторонний, O — участник другой группы,
-- откуда пересылают в группу.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/chat_threads_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon, service_role;
grant all on results_n_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000017a1', 'ta@test.local', '{"full_name":"Тред A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000017b1', 'tb@test.local', '{"full_name":"Тред B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000017c1', 'tc@test.local', '{"full_name":"Тред C"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000017d1', 'tv@test.local', '{"full_name":"Тред V"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000017e1', 'to@test.local', '{"full_name":"Тред O"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void language sql as $$
  insert into results (name, ok, detail) values (name, ok, detail);
$$;

create function pg_temp.join(p_chat uuid) returns void language plpgsql as $$
begin
  if not exists (select 1 from public.chat_members where chat_id = p_chat and user_id = auth.uid()) then
    perform public.accept_chat_invite(p_chat);
  end if;
end;
$$;

create function pg_temp.send(p_chat uuid, p_text text, p_reply uuid[] default null) returns uuid
language plpgsql as $$
declare
  id uuid;
begin
  id := public.send_media_message(p_chat, p_text, null, p_reply, null);
  set constraints all immediate;
  set constraints all deferred;
  return id;
end;
$$;

update public.privacy_settings set
  message_activity_metadata_visibility = 'everyone',
  activity_status_visibility = 'everyone',
  account_search_visibility = 'everyone',
  profile_identity_masking = 'everyone',
  dialogue_participant_name_masking = 'everyone',
  avatar_visibility = 'everyone',
  dialogue_media_visibility = 'everyone',
  public_message_visibility_delay = 'off'
where user_id in (select id from auth.users where email like 't_@test.local');

insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000017a1', '00000000-0000-4000-8000-0000000017b1', 'accepted', now()),
  ('00000000-0000-4000-8000-0000000017a1', '00000000-0000-4000-8000-0000000017c1', 'accepted', now()),
  ('00000000-0000-4000-8000-0000000017a1', '00000000-0000-4000-8000-0000000017e1', 'accepted', now());

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000017a1';
  b uuid := '00000000-0000-4000-8000-0000000017b1';
  c uuid := '00000000-0000-4000-8000-0000000017c1';
  v uuid := '00000000-0000-4000-8000-0000000017d1';
  o uuid := '00000000-0000-4000-8000-0000000017e1';
  grp uuid;
  src uuid;
  root1 uuid;
  root2 uuid;
  r1 uuid;
  r11 uuid;
  both_roots uuid;
  original uuid;
  fwd uuid;
  island_reply uuid;
  mixed uuid;
  delayed uuid;
  doomed uuid;
  doomed_reply uuid;
  lone uuid;
  n int;
  t text;
  ids uuid[];
  q uuid[];
begin
  perform pg_temp.act_as(a);
  grp := (public.create_chat(array[b, c], 'Группа тредов') ->> 'chat_id')::uuid;
  src := (public.create_chat(array[o], 'Откуда пересылают') ->> 'chat_id')::uuid;
  perform pg_temp.act_as(b);
  perform pg_temp.join(grp);
  perform pg_temp.act_as(c);
  perform pg_temp.join(grp);
  perform pg_temp.act_as(o);
  perform pg_temp.join(src);
  original := pg_temp.send(src, 'оригинал');

  perform pg_temp.act_as(a);
  root1 := pg_temp.send(grp, 'первый корень');
  root2 := pg_temp.send(grp, 'второй корень');
  fwd := public.forward_messages(grp, src, array[original]);
  set constraints all immediate;
  set constraints all deferred;

  perform pg_temp.act_as(b);
  r1 := pg_temp.send(grp, 'ответ на первый', array[root1]);
  perform pg_temp.act_as(c);
  r11 := pg_temp.send(grp, 'ответ на ответ', array[r1]);
  both_roots := pg_temp.send(grp, 'ответ двум тредам', array[r11, root2]);
  island_reply := pg_temp.send(grp, 'ответ на островок', array[original]);
  mixed := pg_temp.send(grp, 'островок и корень', array[original, root2]);

  perform set_config('role', 'postgres', true);

  -- ================================================================== К1.2
  perform pg_temp.check('К1.2 ответ — в треде своего корня',
    (select chat_thread_root_ids = array[root1] from public.messages where id = r1));
  perform pg_temp.check('К1.2 ответ на ответ — в треде исходного',
    (select chat_thread_root_ids = array[root1] from public.messages where id = r11));
  perform pg_temp.check('К1.2 ответ двум тредам — в обоих',
    (select chat_thread_root_ids @> array[root1, root2] and cardinality(chat_thread_root_ids) = 2
     from public.messages where id = both_roots));
  perform pg_temp.check('К1.2 ответ только на островок — не в треде',
    (select chat_thread_root_ids is null from public.messages where id = island_reply));
  perform pg_temp.check('ответ на островок и корень — в треде корня',
    (select chat_thread_root_ids = array[root2] from public.messages where id = mixed));
  perform pg_temp.check('корень и островок — не ответы',
    (select bool_and(chat_thread_root_ids is null) from public.messages where id in (root1, root2, fwd)));

  -- Лента «Тредов» — не-ответы и ответы только на островки.
  perform pg_temp.act_as(v);
  select array_agg(r.id order by r.seq) into ids
  from public.message_rows r where r.chat_id = grp and r.chat_thread_root_ids is null and r.kind <> 'system';
  perform pg_temp.check('лента «Тредов»: корни, островок, ответ на островок',
    ids = array[root1, root2, fwd, island_reply], ids::text);

  -- Сводки глазами постороннего.
  select s.replies_count, s.last_text into n, t
  from public.chat_thread_summaries(array[root1]) s;
  perform pg_temp.check('сводка: ответы на ответы в счёте', n = 3, n::text);
  perform pg_temp.check('сводка: текст последнего ответа', t = 'ответ двум тредам', t);
  perform pg_temp.check('сводка: двое последних ответивших — C, потом B',
    (select (s.people -> 0 ->> 'id')::uuid = c and (s.people -> 1 ->> 'id')::uuid = b and s.others_count = 0
     from public.chat_thread_summaries(array[root1]) s));
  perform pg_temp.check('сводка у не-корня пустая',
    not exists (select 1 from public.chat_thread_summaries(array[island_reply])));

  -- Тред и фильтр цитат.
  select array_agg(l.id order by l.seq) into ids from public.list_chat_thread(root1) l;
  perform pg_temp.check('тред: все ответы по порядку', ids = array[r1, r11, both_roots], ids::text);
  perform pg_temp.check('тред: у ответа на корень цитат нет',
    (select cardinality(l.quote_ids) = 0 from public.list_chat_thread(root1) l where l.id = r1));
  perform pg_temp.check('тред: у ответа на ответ — цитата на него',
    (select l.quote_ids = array[r1] from public.list_chat_thread(root1) l where l.id = r11));
  perform pg_temp.check('тред первого: цитаты второго треда нет',
    (select l.quote_ids = array[r11] from public.list_chat_thread(root1) l where l.id = both_roots));
  perform pg_temp.check('тред второго: цитаты первого треда нет',
    (select cardinality(l.quote_ids) = 0 from public.list_chat_thread(root2) l where l.id = both_roots));
  perform pg_temp.check('тред: страница до номера — самые поздние',
    (select array_agg(l.id order by l.seq) = array[r11] from public.list_chat_thread(root1, null,
      (select seq from public.messages where id = both_roots), 1) l));

  -- ================================================================== К1.1
  perform set_config('role', 'postgres', true);
  update public.privacy_settings set public_message_visibility_delay = 'random_delay' where user_id = c;
  perform pg_temp.act_as(c);
  delayed := pg_temp.send(grp, 'задержанный ответ', array[root2]);
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('задержанный ответ ещё не опубликован',
    (select public_at > now() from public.messages where id = delayed));

  perform pg_temp.act_as(b);
  perform pg_temp.check('К1.1 участник видит задержанный ответ в сводке',
    (select s.replies_count = 3 and s.last_text = 'задержанный ответ'
     from public.chat_thread_summaries(array[root2]) s));
  perform pg_temp.check('К1.1 участник видит задержанный ответ в треде',
    exists (select 1 from public.list_chat_thread(root2) l where l.id = delayed));

  perform pg_temp.act_as(v);
  select s.replies_count, s.last_text into n, t from public.chat_thread_summaries(array[root2]) s;
  perform pg_temp.check('К1.1 посторонний не видит задержанный ответ в счёте', n = 2, n::text);
  perform pg_temp.check('К1.1 посторонний не видит задержанный ответ в превью', t = 'островок и корень', t);
  perform pg_temp.check('К1.1 посторонний не видит задержанный ответ в треде',
    not exists (select 1 from public.list_chat_thread(root2) l where l.id = delayed));

  -- Только задержанный ответ у корня — посторонний не видит и плашки.
  perform pg_temp.act_as(a);
  doomed := pg_temp.send(grp, 'корень под удаление');
  perform pg_temp.act_as(c);
  lone := pg_temp.send(grp, 'задержанный единственный', array[doomed]);
  perform pg_temp.act_as(v);
  perform pg_temp.check('К1.1 посторонний: у корня с одним задержанным ответом сводки нет',
    not exists (select 1 from public.chat_thread_summaries(array[doomed])));

  -- ============================================= корни пишет только база
  -- Прямая вставка участника с подставленными корнями: база их обнуляет —
  -- чужой тред подделкой не пополнить, из ленты «Тредов» не уйти.
  perform pg_temp.act_as(a);
  insert into public.messages (id, chat_id, author_id, kind, text, chat_thread_root_ids)
  values (gen_random_uuid(), grp, a, 'text', 'подделка корней', array[root1, src]);
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('подставленные корни при вставке обнуляются',
    (select chat_thread_root_ids is null from public.messages where text = 'подделка корней'));
  update public.messages set chat_thread_root_ids = array[original]
  where text = 'подделка корней';
  perform pg_temp.act_as(v);
  perform pg_temp.check('ответ из чужого чата в треде не считается',
    not exists (
      select 1 from public.list_chat_thread(original) l
    ));

  -- ===================================================== удалённый корень
  perform set_config('role', 'postgres', true);
  update public.privacy_settings set public_message_visibility_delay = 'off' where user_id = c;
  -- Опубликовать задержанные: водораздел больше не держит.
  update public.messages set public_at = created_at where chat_id = grp and public_at > now();
  perform pg_temp.act_as(b);
  doomed_reply := pg_temp.send(grp, 'ответ удалённому', array[doomed]);
  perform pg_temp.act_as(a);
  perform public.delete_messages(array[doomed]);
  perform pg_temp.act_as(v);
  select array_agg(d.id) into ids from public.list_chat_thread_deleted_roots(grp) d;
  perform pg_temp.check('удалённый корень с ответами — заглушка', ids = array[doomed], ids::text);
  perform pg_temp.check('удалённый корень: тред открывается',
    exists (select 1 from public.list_chat_thread(doomed) l where l.id = doomed_reply));
  perform pg_temp.check('удалённый корень: сводка есть',
    (select s.replies_count = 2 from public.chat_thread_summaries(array[doomed]) s));

  perform pg_temp.act_as(b);
  perform public.delete_messages(array[doomed_reply]);
  perform pg_temp.act_as(c);
  perform public.delete_messages(array[lone]);
  perform pg_temp.act_as(v);
  perform pg_temp.check('удалённый корень без живых ответов не показывается',
    not exists (select 1 from public.list_chat_thread_deleted_roots(grp)));
end;
$$;

reset role;
select n, ok, name, detail from results order by n;

rollback;
