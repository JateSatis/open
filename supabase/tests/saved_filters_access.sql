-- Сохранённые, этап 4: фильтры и поиск — только по своим записям, на сервере, страницами.
--
-- Запуск против облачной базы, ничего не оставляет после себя — всё внутри
-- транзакции с rollback:
--   npx supabase db query --linked -f supabase/tests/saved_filters_access.sql
-- Результат — таблица проверок; каждая строка должна быть ok = true.

begin;

create temp table results (n serial, name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant all on results_n_seq to authenticated, anon;

-- Записи фикстуры по именам: тест про фильтры, а не про сохранение, поэтому
-- копии вставляются прямо в таблицу.
create temp table fx (name text primary key, id uuid);
grant all on fx to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-8000-0000000029a1', 'fa@test.local', '{"full_name":"Автор A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000029b1', 'fb@test.local', '{"full_name":"Владелец B"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000029e1', 'fz@test.local', '{"full_name":"Чужой Z"}', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into results (name, ok, detail) values (name, coalesce(ok, false), detail) $$;

create function pg_temp.fx(names text[]) returns uuid[] language sql as $$
  select coalesce(array_agg(id order by id), '{}') from fx where name = any (names)
$$;

create function pg_temp.sorted(ids uuid[]) returns uuid[] language sql as $$
  select coalesce(array_agg(x order by x), '{}') from unnest(ids) x
$$;

-- Что отдаёт «Все» под фильтром (одной страницей).
create function pg_temp.all_of(f jsonb) returns uuid[] language sql as $$
  select pg_temp.sorted(array(select id from public.list_saved_messages(null, 100, null, f)))
$$;

-- Те же имена — то же множество id.
create function pg_temp.same(f jsonb, names text[]) returns boolean language sql as $$
  select pg_temp.all_of(f) = pg_temp.fx(names)
$$;

create function pg_temp.names(ids uuid[]) returns text language sql as $$
  select string_agg(name, ',' order by name) from fx where id = any (ids)
$$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000029a1';
  b uuid := '00000000-0000-4000-8000-0000000029b1';
  z uuid := '00000000-0000-4000-8000-0000000029e1';
  r jsonb;
  chan uuid;
  pop uuid;
  work uuid;
  ideas uuid;
  row_ record;
  sid uuid;
begin
  perform pg_temp.act_as(a);
  r := public.create_channel('Канал фильтров', 'saved_filters_zz');
  chan := (r ->> 'channel_id')::uuid;
  reset role;

  -- Файлы попа не проверяются: тест не про очистку медиа.
  alter table public.pops disable trigger user;
  insert into public.pops (channel_id, author_id, url, poster_url, mime_type, width, height, duration_ms)
  values (chan, a, 'pops/v.mp4', 'pops/p.jpg', 'video/mp4', 720, 1280, 5000)
  returning id into pop;
  alter table public.pops enable trigger user;

  insert into public.saved_tags (owner_id, name, color) values (b, 'Работа', 0) returning id into work;
  insert into public.saved_tags (owner_id, name, color) values (b, 'Идеи', 1) returning id into ideas;
  insert into fx values ('tag_work', work), ('tag_ideas', ideas);

  for row_ in
    select * from (values
      ('ch_voice',   'message', 'channel', 'voice',      null,                null::uuid, '2026-08-05'),
      ('ch_pop',     'message', 'channel', 'media',      null,                pop,        '2026-08-10'),
      ('ch_pop_cap', 'message', 'channel', 'media',      'подпись к попу',    pop,        '2026-07-15'),
      ('mem_voice',  'message', 'member',  'voice',      'голос с текстом',   null,       '2026-07-20'),
      ('mem_circle', 'message', 'member',  'video_note', null,                null,       '2026-10-01'),
      ('vis_text',   'message', 'visitor', 'text',       'Ёжик в тумане',     null,       '2026-09-01'),
      ('note_text',  'note',    'note',    'text',       'Заметка про ЕЖИКА', null,       '2026-08-20'),
      ('note_voice', 'note',    'note',    'voice',      null,                null,       '2026-08-25'),
      ('z_note',     'note',    'note',    'text',       'ёжик чужой',        null,       '2026-08-21')
    ) v(name, source_type, category, kind, text, pop_id, at)
  loop
    insert into public.saved_messages (owner_id, source_type, source_category, kind, text, pop_id, created_at)
    values (case when row_.name = 'z_note' then z else b end, row_.source_type, row_.category, row_.kind,
      row_.text, row_.pop_id, row_.at::timestamptz)
    returning id into sid;
    insert into fx values (row_.name, sid);
  end loop;

  -- Название попа — из снимка вложения.
  insert into public.saved_message_attachments (saved_id, owner_id, position, url, poster_url, mime_type, pop_id, pop_channel_id, pop_title)
  select f.id, b, 0, 'pops/v.mp4', 'pops/p.jpg', 'video/mp4', pop, chan, 'Ёлка на празднике'
  from fx f where f.name in ('ch_pop', 'ch_pop_cap');

  insert into public.saved_message_tags (saved_id, tag_id, owner_id)
  select f.id, case when f.name in ('ch_voice', 'note_text') then work else ideas end, b
  from fx f where f.name in ('ch_voice', 'note_text', 'vis_text', 'note_voice');

  -- «Посмотреть позже» и закрепы — для страниц и полосы.
  update public.saved_messages s set watch_later_at = s.created_at, pinned_at = s.created_at
  where s.id in (select id from fx where name in ('ch_voice', 'ch_pop', 'mem_voice', 'vis_text', 'note_text', 'note_voice'));
  update public.saved_messages s set watch_done_at = s.created_at + interval '1 day'
  where s.id in (select id from fx where name in ('vis_text', 'note_voice'));
end;
$$;

do $$
declare
  b uuid := '00000000-0000-4000-8000-0000000029b1';
  z uuid := '00000000-0000-4000-8000-0000000029e1';
  work text := (select id::text from fx where name = 'tag_work');
  ideas text := (select id::text from fx where name = 'tag_ideas');
  f jsonb;
  got uuid[];
  page uuid[];
  cursor_ bigint;
  w_done boolean;
  w_at timestamptz;
  w_seq bigint;
  w_id uuid;
  n int;
begin
  perform pg_temp.act_as(b);

  -- ================================================== К1.1 — каждый фильтр и сочетание
  perform pg_temp.check('без фильтра — все свои восемь',
    pg_temp.same(null, array['ch_voice','ch_pop','ch_pop_cap','mem_voice','mem_circle','vis_text','note_text','note_voice']));
  perform pg_temp.check('тег «Работа»',
    pg_temp.same(jsonb_build_object('tags', jsonb_build_array(work)), array['ch_voice','note_text']),
    pg_temp.names(pg_temp.all_of(jsonb_build_object('tags', jsonb_build_array(work)))));
  perform pg_temp.check('теги «Работа» или «Идеи»',
    pg_temp.same(jsonb_build_object('tags', jsonb_build_array(work, ideas)), array['ch_voice','note_text','vis_text','note_voice']));
  perform pg_temp.check('категория «Мои заметки»',
    pg_temp.same('{"categories":["note"]}', array['note_text','note_voice']));
  perform pg_temp.check('категории «Каналы» или «Чужие чаты»',
    pg_temp.same('{"categories":["channel","visitor"]}', array['ch_voice','ch_pop','ch_pop_cap','vis_text']));
  perform pg_temp.check('категория «Свои чаты»',
    pg_temp.same('{"categories":["member"]}', array['mem_voice','mem_circle']));
  perform pg_temp.check('даты: август',
    pg_temp.same('{"from":"2026-08-01T00:00:00Z","to":"2026-09-01T00:00:00Z"}', array['ch_voice','ch_pop','note_text','note_voice']),
    pg_temp.names(pg_temp.all_of('{"from":"2026-08-01T00:00:00Z","to":"2026-09-01T00:00:00Z"}')));
  perform pg_temp.check('даты: только «от»',
    pg_temp.same('{"from":"2026-08-20T00:00:00Z"}', array['note_text','note_voice','vis_text','mem_circle']));
  perform pg_temp.check('даты: только «до»',
    pg_temp.same('{"to":"2026-08-01T00:00:00Z"}', array['ch_pop_cap','mem_voice']));
  perform pg_temp.check('тип «Голосовое»',
    pg_temp.same('{"types":["voice"]}', array['ch_voice','note_voice']));
  perform pg_temp.check('типы «Голосовое» или «Попсы»',
    pg_temp.same('{"types":["voice","pop"]}', array['ch_voice','note_voice','ch_pop']));
  perform pg_temp.check('тип «Текст и медиа»',
    pg_temp.same('{"types":["text_media"]}', array['ch_pop_cap','mem_voice','mem_circle','vis_text','note_text']));
  f := jsonb_build_object('tags', jsonb_build_array(work, ideas), 'categories', jsonb_build_array('channel', 'note'),
    'from', '2026-08-01T00:00:00Z', 'to', '2026-09-01T00:00:00Z', 'types', jsonb_build_array('voice'));
  perform pg_temp.check('тег + категория + даты + тип: «и» между группами',
    pg_temp.same(f, array['ch_voice','note_voice']), pg_temp.names(pg_temp.all_of(f)));
  perform pg_temp.check('пустые массивы — без условия',
    cardinality(pg_temp.all_of('{"tags":[],"categories":[],"types":[]}')) = 8);

  -- ================================================== К1.3 — поиск
  perform pg_temp.check('поиск без регистра и ё/е: «ежик»',
    pg_temp.same('{"q":"ежик"}', array['vis_text','note_text']), pg_temp.names(pg_temp.all_of('{"q":"ежик"}')));
  perform pg_temp.check('поиск по части слова: «ЖИК»',
    pg_temp.same('{"q":"ЖИК"}', array['vis_text','note_text']));
  perform pg_temp.check('поиск по названию попа из снимка: «елк»',
    pg_temp.same('{"q":"елк"}', array['ch_pop','ch_pop_cap']));
  perform pg_temp.check('поиск с фильтром «Мои заметки»',
    pg_temp.same('{"q":"ёжик","categories":["note"]}', array['note_text']));
  perform pg_temp.check('счётчик сходится с выдачей',
    public.count_saved_messages('{"q":"ежик"}') = 2
      and public.count_saved_messages('{"q":"ежик","categories":["note"]}') = 1
      and public.count_saved_messages(null) = 8);
  perform pg_temp.check('чужая запись не находится',
    cardinality(pg_temp.all_of('{"q":"чужой"}')) = 0
      and public.count_saved_messages('{"q":"чужой"}') = 0);
  perform pg_temp.check('пустой запрос — без условия',
    cardinality(pg_temp.all_of('{"q":"   "}')) = 8);

  -- ================================================== К1.4 — страницы под фильтром
  f := '{"types":["text_media"]}';
  got := '{}';
  cursor_ := null;
  loop
    page := array(select id from public.list_saved_messages(cursor_, 2, null, f));
    exit when cardinality(page) = 0;
    got := got || page;
    cursor_ := (select min(seq) from public.saved_messages where id = any (page));
  end loop;
  perform pg_temp.check('«Все» к старым по две: без потерь и дублей',
    cardinality(got) = 5 and pg_temp.sorted(got) = pg_temp.all_of(f), pg_temp.names(got));

  got := '{}';
  cursor_ := 0;
  loop
    page := array(select id from public.list_saved_messages(null, 2, cursor_, f));
    exit when cardinality(page) = 0;
    got := got || page;
    cursor_ := (select max(seq) from public.saved_messages where id = any (page));
  end loop;
  perform pg_temp.check('«Все» к новым по две: без потерь и дублей',
    cardinality(got) = 5 and pg_temp.sorted(got) = pg_temp.all_of(f));

  -- «Посмотреть позже» под фильтром «Работа или Идеи» по одной: активные, потом выполненные.
  f := jsonb_build_object('tags', jsonb_build_array(work, ideas));
  got := '{}';
  for n in 1 .. 10 loop
    w_id := null;
    select x.id, x.watch_done_at is not null, coalesce(x.watch_done_at, x.watch_later_at), x.seq
    into w_id, w_done, w_at, w_seq
    from public.list_saved_watch_later(w_done, w_at, w_seq, 1, f) x;
    exit when w_id is null;
    got := got || w_id;
  end loop;
  perform pg_temp.check('«Посмотреть позже» по одной под фильтром: все четыре, без дублей',
    cardinality(got) = 4 and pg_temp.sorted(got) = pg_temp.fx(array['ch_voice','note_text','vis_text','note_voice'])
      and got[3:4] <@ pg_temp.fx(array['vis_text','note_voice']),
    pg_temp.names(got));

  perform pg_temp.check('закрепы под фильтром «Каналы»',
    pg_temp.sorted(array(select id from public.list_saved_pins('{"categories":["channel"]}')))
      = pg_temp.fx(array['ch_voice','ch_pop']));
  perform pg_temp.check('закрепы без фильтра — все шесть',
    (select count(*) from public.list_saved_pins()) = 6);

  -- Чужой видит только своё — и под фильтром, и в поиске.
  perform pg_temp.act_as(z);
  perform pg_temp.check('чужой: «ежик» — только его запись',
    pg_temp.all_of('{"q":"ежик"}') = pg_temp.fx(array['z_note'])
      and public.count_saved_messages('{"categories":["channel"]}') = 0
      and (select count(*) from public.list_saved_pins()) = 0);
end;
$$;

reset role;

-- Правило типа закрыто от клиента — проверяется правами владельца.
do $$
begin
  -- ================================================== К1.2 — правило типа
  perform pg_temp.check('голосовое с текстом — не «Голосовое»',
    public.saved_type('voice', 'голос с текстом', null) = 'text_media');
  perform pg_temp.check('пост с попом и подписью — не «Попсы»',
    public.saved_type('media', 'подпись', gen_random_uuid()) = 'text_media'
      and public.saved_type('media', null, gen_random_uuid()) = 'pop');
  perform pg_temp.check('кружок — «Текст и медиа», голосовое без текста — «Голосовое»',
    public.saved_type('video_note', null, null) = 'text_media'
      and public.saved_type('voice', '  ', null) = 'voice');

end;
$$;

select n, ok, name, detail from results order by n;

rollback;
