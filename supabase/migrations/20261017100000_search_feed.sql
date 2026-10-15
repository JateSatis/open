-- Поиск, этап 3: название попа и поиск попсов и каналов в «Ленте».
--
-- Движок — тот же, что у «Чатов» (`20261016100000_search.sql`): нормализация
-- `search_norm`, разбор запроса `search_parse`, уровни `search_level`,
-- морфология `search_tsv` / `search_tsquery`, порог опечаток 0.45.
--
-- Две выдачи:
--   «Каналы» — все живые каналы, одним списком: мои, подписки, чужие;
--   «Попсы»  — по названию и подписи попа и по названию и @имени его канала,
--              страницами по рангу и скору популярности.

-- =============================================================================
-- Название попа
-- =============================================================================
--
-- Обязательно для новых попсов, старые остаются без него. Обязательность
-- проверяет `publish_pop`, а не `CHECK (title is not null) not valid`: такая
-- проверка срабатывает на любом UPDATE старой строки, а счётчики реакций и
-- просмотров обновляют строку попа — у старых попсов они перестали бы расти.
-- Длина — продуктовый лимит, он на клиенте рядом с лимитом подписи.

alter table public.pops
  add column title text,
  add constraint pops_title_not_blank check (title is null or btrim(title) <> '');

drop function public.publish_pop(uuid, uuid, jsonb, text, boolean, text, uuid[]);

/**
 * Публикует поп в канале и, по флагу, в той же транзакции пост с ним.
 *
 * `new_pop` — id, который выбрал клиент: повтор после обрыва связи (ответ
 * потерялся, а транзакция прошла) отдаёт уже созданное, а не второй поп.
 * Файл попа (`media`) — объект с теми же полями, что вложение:
 * url, poster_url, mime_type, width, height, duration_ms, size_bytes.
 * `title` обязателен; текст поста — `post_text`, название в пост не идёт.
 *
 * Отдаёт `{ pop_id, message_id }`; `message_id` — `null`, если поста нет.
 */
create function public.publish_pop(
  target_channel uuid,
  new_pop uuid,
  media jsonb,
  title text,
  caption text default null,
  also_post boolean default false,
  post_text text default null,
  reply_to uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  posts_chat uuid;
  existing public.pops;
  new_message uuid;
  clean_title text := nullif(btrim(coalesce(title, '')), '');
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not public.can_publish_in_channel(target_channel) then
    raise exception 'Публиковать в канале может только его автор' using errcode = '42501';
  end if;

  if clean_title is null then
    raise exception 'У попа должно быть название' using errcode = '23514';
  end if;

  if media is null or jsonb_typeof(media) <> 'object' then
    raise exception 'media должен быть json-объектом' using errcode = '22023';
  end if;

  select * into existing from public.pops where id = new_pop;

  if existing.id is not null then
    if existing.author_id is distinct from me or existing.channel_id <> target_channel then
      raise exception 'pop already exists' using errcode = '23505';
    end if;

    return jsonb_build_object(
      'pop_id', existing.id,
      'message_id', (
        select a.message_id from public.attachments a
        join public.messages m on m.id = a.message_id
        where a.pop_id = existing.id and m.author_id = me
        order by a.created_at
        limit 1
      )
    );
  end if;

  select posts_chat_id into posts_chat from public.channels where id = target_channel;

  insert into public.pops (
    id, channel_id, author_id, title, caption, url, poster_url, mime_type, width, height,
    duration_ms, size_bytes
  ) values (
    new_pop,
    target_channel,
    me,
    clean_title,
    nullif(btrim(coalesce(caption, '')), ''),
    media ->> 'url',
    nullif(media ->> 'poster_url', ''),
    media ->> 'mime_type',
    nullif(media ->> 'width', '')::int,
    nullif(media ->> 'height', '')::int,
    nullif(media ->> 'duration_ms', '')::int,
    nullif(media ->> 'size_bytes', '')::bigint
  );

  if also_post then
    new_message := public.insert_pop_post(posts_chat, new_pop, post_text, reply_to);
  end if;

  return jsonb_build_object('pop_id', new_pop, 'message_id', new_message);
end;
$$;

revoke execute on function public.publish_pop(uuid, uuid, jsonb, text, text, boolean, text, uuid[]) from public, anon;
grant execute on function public.publish_pop(uuid, uuid, jsonb, text, text, boolean, text, uuid[]) to authenticated;

-- =============================================================================
-- Индексы
-- =============================================================================
--
-- Как у сообщений: триграммы по нормализованному тексту (подстрока, начало,
-- опечатка) и полнотекстовый документ для морфологии. Документ — название и
-- подпись одной строкой: оба поля попа ищутся одним запросом. Только живые
-- попсы. Каналы обслуживают индексы этапа 2 (`channels_search_*`).

create index pops_search_title_idx
  on public.pops using gin (public.search_norm(title) extensions.gin_trgm_ops)
  where deleted_at is null and title is not null;

create index pops_search_caption_idx
  on public.pops using gin (public.search_norm(caption) extensions.gin_trgm_ops)
  where deleted_at is null and caption is not null;

create index pops_search_tsv_idx
  on public.pops using gin (public.search_tsv(coalesce(title, '') || ' ' || coalesce(caption, '')))
  where deleted_at is null;

-- =============================================================================
-- Каналы
-- =============================================================================

/**
 * Каналы для «Ленты»: все живые, одним списком, не больше `max_count`.
 *
 * Ранг — как у `search_entities`: уровень совпадения по @имени и по названию
 * (с `@` впереди — сначала @имя), дальше — больше подписчиков, название, id.
 * `.ch` ничего не меняет (здесь и так только каналы), `.di` — каналов нет.
 *
 * `subscribed` — я подписан, `mine` — я могу в нём публиковать.
 * Invoker: каналы открыты на чтение, свою подписку человек читает сам.
 */
create function public.search_channels(query text, max_count int default 50)
returns table (
  id uuid,
  posts_chat_id uuid,
  title text,
  username text,
  avatar_url text,
  subscribers_count int,
  subscribed boolean,
  mine boolean
)
language plpgsql
stable
set search_path = public, extensions
set pg_trgm.word_similarity_threshold = 0.45
as $$
#variable_conflict use_column
declare
  q record;
  pattern text;
  fuzzy boolean;
  user_pattern text;
  user_fuzzy boolean;
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into q from public.search_parse(query);

  if q.text_query = '' or q.kind = 'group' then
    return;
  end if;

  pattern := public.search_like(q.text_query);
  fuzzy := char_length(q.text_query) >= 4;
  user_pattern := case when q.username_query is not null then public.search_like(q.username_query) end;
  user_fuzzy := char_length(q.username_query) >= 4;

  return query
  with candidates as (
    select
      ch.*,
      public.search_level(lower(ch.username), q.username_query) as u_level,
      public.search_level(public.search_norm(ch.title), q.text_query) as t_level
    from public.channels ch
    where ch.deleted_at is null
      and (
        public.search_norm(ch.title) like pattern
        or (fuzzy and q.text_query <% public.search_norm(ch.title))
        or lower(ch.username) like user_pattern
        or (user_fuzzy and q.username_query <% lower(ch.username))
      )
  )
  select
    c.id,
    c.posts_chat_id,
    c.title,
    c.username,
    c.avatar_url,
    c.subscribers_count,
    exists (
      select 1 from public.subscriptions s
      where s.channel_id = c.id and s.subscriber_id = auth.uid()
    ),
    public.can_publish_in_channel(c.id)
  from candidates c
  where c.u_level > 0 or c.t_level > 0
  order by
    case when q.by_username then c.u_level else greatest(c.u_level, c.t_level) end desc,
    case when q.by_username then c.t_level else least(c.u_level, c.t_level) end desc,
    c.subscribers_count desc,
    public.search_norm(c.title),
    c.id
  limit least(greatest(coalesce(max_count, 50), 1), 100);
end;
$$;

revoke execute on function public.search_channels(text, int) from public, anon;
grant execute on function public.search_channels(text, int) to authenticated;

-- =============================================================================
-- Попсы
-- =============================================================================

/**
 * Скор популярности и свежести попа в духе ленты: вовлечённость, делённая на
 * возраст в степени. Просмотр дешевле реакции, реакция — комментария; +1 —
 * чтобы у нового попа без сигналов скор был не нулём и решал возраст; +2 часа
 * к возрасту — чтобы только что опубликованный не улетал в бесконечность.
 * Округление — чтобы скор, отданный клиенту и вернувшийся курсором, совпал
 * с посчитанным до последнего знака.
 */
create function public.pop_search_score(
  views_count int,
  reactions_count int,
  comments_count int,
  created_at timestamptz,
  as_of timestamptz
)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select round((
    (1 + 0.25 * views_count + 2 * reactions_count + 3 * comments_count)
    / power(greatest(extract(epoch from as_of - created_at) / 3600, 0) + 2, 1.5)
  )::numeric, 9)
$$;

/**
 * Попсы по запросу, страницами без offset.
 *
 * Уровень попа — лучшее из совпадений по его названию и подписи
 * (`search_level`; слово в другой форме — по морфологии — как начало слова).
 * Совпадение только по каналу (название или @имя) — ниже любого совпадения
 * собственным текстом: `rank` 5..8 — свой текст, 1..4 — только канал.
 * Внутри ранга — `pop_search_score`, потом id.
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
create function public.search_pops(
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
  with matched_channels as (
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
      case when r.own_level > 0 then 4 + r.own_level else r.channel_level end as pop_rank,
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
