-- Ранг попа: запрос короче трёх символов совпадает с каналом только с начала
-- слова, как и с текстом попа. Раньше одна буква внутри названия канала
-- (уровень 2) приводила в выдачу все попсы таких каналов — шум и полный
-- перебор на каждую букву. Сигнатура та же.

-- `set pg_trgm.…` в определении функции требует, чтобы модуль уже был
-- загружен в сессии, иначе 42501 «permission denied to set parameter».
select extensions.similarity('a', 'b');

/**
 * Попсы по запросу, страницами без offset.
 *
 * Уровень попа — лучшее из совпадений по его названию и подписи
 * (`search_level`; слово в другой форме — по морфологии — как начало слова).
 * Совпадение только по каналу (название или @имя) — ниже совпадения
 * собственным текстом того же уровня: `rank` = уровень × 2, у своего текста
 * +1 (свой текст 3, 5, 7, 9; только канал 2, 4, 6, 8). Поп, совпавший и
 * текстом, и каналом, берёт лучшее. Внутри ранга — `pop_search_score`,
 * потом id.
 *
 * Скор зависит от времени, поэтому момент отсчёта `as_of` фиксирует первая
 * страница (null → now()) и отдаёт в каждой строке, а следующие получают его
 * обратно вместе с курсором — последней строкой прошлой страницы
 * (`after_rank`, `after_score`, `after_id`). Счётчики между страницами
 * меняются — поп может переехать, и клиент выкидывает повтор по id.
 *
 * `@` и суффикс текст поиска не сужают: ищется запрос без них.
 * Удалённые попсы и попсы удалённых каналов не выдаются.
 * Invoker: попсы, каналы и реакции открыты на чтение.
 */
create or replace function public.search_pops(
  query text,
  as_of timestamptz default null,
  after_rank int default null,
  after_score numeric default null,
  after_id uuid default null,
  page_size int default 30
)
returns table (
  id uuid,
  channel_id uuid,
  author_id uuid,
  title text,
  caption text,
  url text,
  poster_url text,
  mime_type text,
  width int,
  height int,
  duration_ms int,
  created_at timestamptz,
  reactions jsonb,
  views_count int,
  comments_count int,
  my_reaction text,
  channel_title text,
  channel_avatar_url text,
  rank int,
  score numeric,
  scored_at timestamptz
)
language plpgsql
stable
set search_path = public, extensions
set pg_trgm.word_similarity_threshold = 0.45
as $$
#variable_conflict use_column
declare
  q record;
  needle text;
  tsq tsquery;
  pattern text;
  use_like boolean;
  fuzzy boolean;
  user_pattern text;
  user_fuzzy boolean;
  moment timestamptz := coalesce(as_of, now());
  lim int := least(greatest(coalesce(page_size, 30), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into q from public.search_parse(query);
  needle := q.text_query;

  if needle is null or needle = '' then
    return;
  end if;

  tsq := public.search_tsquery(needle);
  pattern := public.search_like(needle);
  -- Подстроку короче трёх символов триграммный индекс не сужает — короткому
  -- запросу хватает начала слова (морфология с `:*`).
  use_like := char_length(needle) >= 3;
  fuzzy := char_length(needle) >= 4;
  user_pattern := case when q.username_query is not null then public.search_like(q.username_query) end;
  user_fuzzy := char_length(q.username_query) >= 4;

  return query
  with channel_hits as (
    select
      ch.id,
      greatest(
        public.search_level(lower(ch.username), q.username_query),
        public.search_level(public.search_norm(ch.title), needle)
      ) as level
    from public.channels ch
    where ch.deleted_at is null
      and (
        public.search_norm(ch.title) like pattern
        or (fuzzy and needle <% public.search_norm(ch.title))
        or lower(ch.username) like user_pattern
        or (user_fuzzy and q.username_query <% lower(ch.username))
      )
  ),
  -- Короткий запрос, как и текст попа, совпадает с каналом только с начала
  -- слова: иначе одна буква внутри названий привела бы попсы половины каналов.
  matched_channels as (
    select h.id, h.level from channel_hits h
    where h.level >= case when use_like then 1 else 3 end
  ),
  by_text as (
    select p.id
    from public.pops p
    where p.deleted_at is null
      and (
        (tsq is not null
          and public.search_tsv(coalesce(p.title, '') || ' ' || coalesce(p.caption, '')) @@ tsq)
        or (use_like and p.title is not null and public.search_norm(p.title) like pattern)
        or (use_like and p.caption is not null and public.search_norm(p.caption) like pattern)
        or (fuzzy and p.title is not null and needle <% public.search_norm(p.title))
        or (fuzzy and p.caption is not null and needle <% public.search_norm(p.caption))
      )
    union
    select p.id
    from public.pops p
    join matched_channels mc on mc.id = p.channel_id and mc.level > 0
    where p.deleted_at is null
  ),
  ranked as (
    select
      p.*,
      ch.title as ch_title,
      ch.avatar_url as ch_avatar_url,
      greatest(
        public.search_level(public.search_norm(p.title), needle),
        public.search_level(public.search_norm(p.caption), needle),
        case
          when tsq is not null
            and public.search_tsv(coalesce(p.title, '') || ' ' || coalesce(p.caption, '')) @@ tsq
          then 3 else 0
        end
      ) as own_level,
      coalesce(mc.level, 0) as channel_level
    from by_text t
    join public.pops p on p.id = t.id
    join public.channels ch on ch.id = p.channel_id and ch.deleted_at is null
    left join matched_channels mc on mc.id = p.channel_id
  ),
  scored as (
    select
      r.*,
      greatest(
        case when r.own_level > 0 then r.own_level * 2 + 1 else 0 end,
        r.channel_level * 2
      ) as pop_rank,
      public.pop_search_score(
        r.views_count, r.reactions_count, r.comments_count, r.created_at, moment
      ) as pop_score
    from ranked r
  ),
  page as (
    select s.*
    from scored s
    where s.pop_rank > 0
      and (
        after_id is null
        or (s.pop_rank, s.pop_score, s.id) < (after_rank, after_score, after_id)
      )
    order by s.pop_rank desc, s.pop_score desc, s.id desc
    limit lim
  )
  select
    pg.id,
    pg.channel_id,
    pg.author_id,
    pg.title,
    pg.caption,
    pg.url,
    pg.poster_url,
    pg.mime_type,
    pg.width,
    pg.height,
    pg.duration_ms,
    pg.created_at,
    pg.reactions,
    pg.views_count,
    pg.comments_count,
    (
      select r.emoji from public.reactions r
      where r.target_type = 'pop' and r.target_id = pg.id
        and r.user_id = auth.uid() and r.deleted_at is null
      limit 1
    ),
    pg.ch_title,
    pg.ch_avatar_url,
    pg.pop_rank,
    pg.pop_score,
    moment
  from page pg
  order by pg.pop_rank desc, pg.pop_score desc, pg.id desc;
end;
$$;

revoke execute on function public.search_pops(text, timestamptz, int, numeric, uuid, int) from public, anon;
grant execute on function public.search_pops(text, timestamptz, int, numeric, uuid, int) to authenticated;
