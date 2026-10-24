-- Сохранённые сообщения, этап 4: фильтры и поиск.
--
-- Фильтр — один `jsonb` для всех списков «Сохранённых» (страницы «Все»,
-- окно вокруг записи, «Посмотреть позже», закрепы) и счётчика поиска:
--   tags        uuid[]  — любой из тегов;
--   categories  text[]  — любая из категорий (channel | member | visitor | note);
--   from, to    момент  — дата сохранения в [from, to): границы дней в поясе
--                         устройства считает клиент;
--   types       text[]  — любой из видов (`saved_type`): voice | pop | text_media;
--   q           text    — поиск по тексту и названию попа.
-- Пустой массив или отсутствующий ключ — без условия. Внутри группы — «любой
-- из», между группами — «и». Разбирает фильтр одна функция, проверяет запись
-- одна функция: списки не расходятся.

-- ---------------------------------------------------------------- вид записи

-- Вид записи для фильтра «Тип сообщения» — правило в одном месте. Голосовое —
-- голосовое без текста; попсы — пост с попом без текста; всё остальное
-- (текст, фото, видео, альбом, кружок, голосовое или поп с подписью) —
-- «Текст и медиа». Файловых сообщений в Open пока нет.
create function public.saved_type(p_kind text, p_text text, p_pop_id uuid)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when nullif(btrim(p_text), '') is null and p_kind = 'voice' then 'voice'
    when nullif(btrim(p_text), '') is null and p_pop_id is not null then 'pop'
    else 'text_media'
  end
$$;

revoke execute on function public.saved_type(text, text, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------- фильтр

create type public.saved_filter as (
  tags uuid[],
  categories text[],
  from_at timestamptz,
  to_at timestamptz,
  types text[],
  -- Поиск: запрос к документу, шаблон подстроки (от трёх букв) — как у
  -- `search_chat_messages`.
  tsq tsquery,
  pattern text,
  searching boolean
);

-- Разбор фильтра один раз на вызов. Пустые массивы — `null`: без условия.
create function public.saved_filter_of(p_filter jsonb)
returns public.saved_filter
language plpgsql
stable
parallel safe
set search_path = ''
as $$
declare
  f public.saved_filter;
  needle text;
begin
  if p_filter is null or jsonb_typeof(p_filter) <> 'object' then
    return f;
  end if;

  if jsonb_typeof(p_filter -> 'tags') = 'array' and jsonb_array_length(p_filter -> 'tags') > 0 then
    f.tags := array(select jsonb_array_elements_text(p_filter -> 'tags')::uuid);
  end if;

  if jsonb_typeof(p_filter -> 'categories') = 'array' and jsonb_array_length(p_filter -> 'categories') > 0 then
    f.categories := array(select jsonb_array_elements_text(p_filter -> 'categories'));
  end if;

  if jsonb_typeof(p_filter -> 'types') = 'array' and jsonb_array_length(p_filter -> 'types') > 0 then
    f.types := array(select jsonb_array_elements_text(p_filter -> 'types'));
  end if;

  f.from_at := nullif(p_filter ->> 'from', '')::timestamptz;
  f.to_at := nullif(p_filter ->> 'to', '')::timestamptz;

  needle := public.search_norm(p_filter ->> 'q');
  f.searching := needle is not null and needle <> '';

  if f.searching then
    f.tsq := public.search_tsquery(needle);
    f.pattern := case when char_length(needle) >= 3 then public.search_like(needle) end;
  end if;

  return f;
end;
$$;

revoke execute on function public.saved_filter_of(jsonb) from public, anon, authenticated;

-- Подходит ли запись под фильтр. Поиск — по тексту копии или заметки и по
-- названию попа из снимка, без учёта регистра и ё/е.
create function public.saved_matches(s public.saved_messages, f public.saved_filter)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select
    (f.categories is null or s.source_category = any (f.categories))
    and (f.from_at is null or s.created_at >= f.from_at)
    and (f.to_at is null or s.created_at < f.to_at)
    and (f.types is null or public.saved_type(s.kind, s.text, s.pop_id) = any (f.types))
    and (f.tags is null or exists (
      select 1 from public.saved_message_tags t
      where t.saved_id = s.id and t.tag_id = any (f.tags)
    ))
    and (not coalesce(f.searching, false) or (
      (s.text is not null and (
        (f.tsq is not null and public.search_tsv(s.text) @@ f.tsq)
        or (f.pattern is not null and public.search_norm(s.text) like f.pattern)
      ))
      or exists (
        select 1 from public.saved_message_attachments a
        where a.saved_id = s.id and a.pop_title is not null and (
          (f.tsq is not null and public.search_tsv(a.pop_title) @@ f.tsq)
          or (f.pattern is not null and public.search_norm(a.pop_title) like f.pattern)
        )
      )
    ))
$$;

revoke execute on function public.saved_matches(public.saved_messages, public.saved_filter) from public, anon, authenticated;

-- Поиск по тексту — как у сообщений чатов: документ и подстрока. Списки
-- ограничены владельцем, поэтому индексы помогают на больших «Сохранённых»,
-- а на малых план идёт по `owner_id`.
create index saved_messages_search_tsv_idx
  on public.saved_messages using gin (public.search_tsv(text))
  where text is not null;

create index saved_messages_search_trgm_idx
  on public.saved_messages using gin (public.search_norm(text) extensions.gin_trgm_ops)
  where text is not null;

-- ------------------------------------------------------------------- чтение

drop function public.list_saved_messages(bigint, integer, bigint);
drop function public.list_saved_watch_later(boolean, timestamptz, bigint, integer);
drop function public.list_saved_pins();

-- Страница «Все», новыми вперёд, — только подходящие под фильтр. С `q` это
-- и есть выдача поиска на «Все»: совпадения новыми вперёд по `seq`.
create function public.list_saved_messages(
  p_before_seq bigint default null,
  p_limit integer default 30,
  p_after_seq bigint default null,
  p_filter jsonb default null
)
returns table (
  id uuid,
  seq bigint,
  created_at timestamptz,
  source_type text,
  source_category text,
  source_chat_id uuid,
  source_message_id uuid,
  source_comment_id uuid,
  source_seq bigint,
  comment_message_id uuid,
  comment_pop_id uuid,
  kind text,
  text text,
  author_id uuid,
  author_name text,
  author_avatar_url text,
  author_opaque boolean,
  original_at timestamptz,
  pop_id uuid,
  watch_later_at timestamptz,
  watch_done_at timestamptz,
  pinned_at timestamptz,
  attachments jsonb,
  tag_ids uuid[],
  edited boolean,
  replies jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with lim as (select least(greatest(coalesce(p_limit, 30), 1), 100) as n),
  flt as (select public.saved_filter_of(p_filter) as f),
  picked as (
    (
      select s.id from public.saved_messages s
      where s.owner_id = auth.uid() and p_after_seq is null
        and (p_before_seq is null or s.seq < p_before_seq)
        and public.saved_matches(s, (select f from flt))
      order by s.seq desc
      limit (select n from lim)
    )
    union all
    (
      select s.id from public.saved_messages s
      where s.owner_id = auth.uid() and p_after_seq is not null and s.seq > p_after_seq
        and public.saved_matches(s, (select f from flt))
      order by s.seq asc
      limit (select n from lim)
    )
  )
  select r.* from public.saved_rows(array(select id from picked)) r
  order by r.seq desc
$$;

revoke execute on function public.list_saved_messages(bigint, integer, bigint, jsonb) from public, anon;
grant execute on function public.list_saved_messages(bigint, integer, bigint, jsonb) to authenticated;

create function public.list_saved_watch_later(
  p_after_done boolean default null,
  p_after_at timestamptz default null,
  p_after_seq bigint default null,
  p_limit integer default 30,
  p_filter jsonb default null
)
returns table (
  id uuid,
  seq bigint,
  created_at timestamptz,
  source_type text,
  source_category text,
  source_chat_id uuid,
  source_message_id uuid,
  source_comment_id uuid,
  source_seq bigint,
  comment_message_id uuid,
  comment_pop_id uuid,
  kind text,
  text text,
  author_id uuid,
  author_name text,
  author_avatar_url text,
  author_opaque boolean,
  original_at timestamptz,
  pop_id uuid,
  watch_later_at timestamptz,
  watch_done_at timestamptz,
  pinned_at timestamptz,
  attachments jsonb,
  tag_ids uuid[],
  edited boolean,
  replies jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with lim as (select least(greatest(coalesce(p_limit, 30), 1), 100) as n),
  flt as (select public.saved_filter_of(p_filter) as f),
  picked as (
    (
      select s.id, false as done, s.watch_later_at as at, s.seq
      from public.saved_messages s
      where s.owner_id = auth.uid() and s.watch_later_at is not null and s.watch_done_at is null
        and (p_after_done is null
          or (not p_after_done and (s.watch_later_at, s.seq) < (p_after_at, p_after_seq)))
        and public.saved_matches(s, (select f from flt))
      order by s.watch_later_at desc, s.seq desc
      limit (select n from lim)
    )
    union all
    (
      select s.id, true, s.watch_done_at, s.seq
      from public.saved_messages s
      where s.owner_id = auth.uid() and s.watch_done_at is not null
        and (p_after_done is null or not p_after_done
          or (s.watch_done_at, s.seq) < (p_after_at, p_after_seq))
        and public.saved_matches(s, (select f from flt))
      order by s.watch_done_at desc, s.seq desc
      limit (select n from lim)
    )
  ),
  page as (
    select p.id from picked p
    order by p.done, p.at desc, p.seq desc
    limit (select n from lim)
  )
  select r.* from public.saved_rows(array(select id from page)) r
  order by r.watch_done_at is not null, coalesce(r.watch_done_at, r.watch_later_at) desc, r.seq desc
$$;

revoke execute on function public.list_saved_watch_later(boolean, timestamptz, bigint, integer, jsonb) from public, anon;
grant execute on function public.list_saved_watch_later(boolean, timestamptz, bigint, integer, jsonb) to authenticated;

-- Закрепы для полосы — только подходящие под фильтр.
create function public.list_saved_pins(p_filter jsonb default null)
returns table (
  id uuid,
  seq bigint,
  kind text,
  text text,
  thumbnail_url text,
  pinned_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with flt as (select public.saved_filter_of(p_filter) as f)
  select s.id, s.seq, s.kind, s.text,
    (
      select case
        when a.pop_id is not null or a.mime_type like 'video/%' then a.poster_url
        when a.mime_type like 'audio/%' then null
        else a.url
      end
      from public.saved_message_attachments a
      where a.saved_id = s.id and not a.media_hidden
      order by a.position
      limit 1
    ),
    s.pinned_at
  from public.saved_messages s
  where s.owner_id = auth.uid() and s.pinned_at is not null
    and public.saved_matches(s, (select f from flt))
  order by s.pinned_at, s.seq
  limit 200
$$;

revoke execute on function public.list_saved_pins(jsonb) from public, anon;
grant execute on function public.list_saved_pins(jsonb) to authenticated;

-- Сколько записей подходит (с `q` — сколько совпадений поиска), с потолком,
-- как `count_chat_search`.
create function public.count_saved_messages(p_filter jsonb default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with flt as (select public.saved_filter_of(p_filter) as f)
  select count(*)::integer
  from (
    select 1 from public.saved_messages s
    where s.owner_id = auth.uid() and public.saved_matches(s, (select f from flt))
    limit 1000
  ) hits
$$;

revoke execute on function public.count_saved_messages(jsonb) from public, anon;
grant execute on function public.count_saved_messages(jsonb) to authenticated;
