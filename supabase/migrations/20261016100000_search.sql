-- Поиск, этап 2: движок поиска в базе и поиск в «Чатах».
--
-- Три вида выдачи:
--   «Чаты»             — мои чаты и все мои подписки, по названию и @имени;
--   «Глобальный поиск» — чужие каналы, люди и группы с @именем;
--   «Сообщения»        — текст сообщений и постов из моих чатов и подписок,
--                        от новых к старым, страницами.
--
-- Всё сравнение — над одной нормализацией `search_norm` (регистр, ё/е,
-- диакритика, пробелы): индексы построены по ней же, иначе планировщик их не
-- узнает. Разбор запроса (`@` и суффикс `.ch` / `.di`) — одна функция
-- `search_parse`, ранг сущности — `search_level`: этап 3 (поиск в «Ленте»)
-- берёт их как есть.
--
-- Нечёткое совпадение — `word_similarity` из pg_trgm с порогом 0.45 и только
-- для запроса от 4 символов. Подобрано на русских примерах (облако, 13.10.2026):
--   мксим → максим 0.50, тлеграм → телеграм 0.63, москав → москве 0.57 — находит;
--   привет → приём 0.43, тест → текст 0.40 — уже нет;
--   канал → каникулы 0.50 — находит, но последним, ниже любой точной строки.
-- Перестановку соседних букв («пирвет» 0.29) триграммы не ловят — это предел
-- метода, не порога.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- =============================================================================
-- Нормализация
-- =============================================================================

/**
 * Текст для сравнения: нижний регистр, ё → е, без диакритики, пробелы
 * схлопнуты. Неизменяемая: на ней стоят индексы. `unaccent` с явным словарём —
 * у функции с одним аргументом пометка stable, в индекс её не взять.
 */
create function public.search_norm(value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    extensions.unaccent('extensions.unaccent'::regdictionary, replace(lower(value), 'ё', 'е')),
    '\s+', ' ', 'g'
  ))
$$;

/** Слова через пробел: знаки препинания — границы слов, как у `to_tsvector`. */
create function public.search_words(value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(value, '[^[:alnum:]]+', ' ', 'g'))
$$;

/** Подстрока для LIKE: `%`, `_` и `\` в запросе — буквы, а не шаблон. */
create function public.search_like(needle text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select '%' || replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;

/**
 * Поисковый документ сообщения: русская морфология («сообщения» находит
 * «сообщение») и `simple` — имена, латиница, коды, стоп-слова, которые
 * русская конфигурация выбрасывает.
 */
create function public.search_tsv(value text)
returns tsvector
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select to_tsvector('pg_catalog.russian'::regconfig, public.search_norm(value))
      || to_tsvector('pg_catalog.simple'::regconfig, public.search_norm(value))
$$;

/**
 * Запрос к документу: каждое слово — в обеих конфигурациях, все слова
 * обязательны, последнее — началом слова (`:*`): человек ещё печатает.
 * Пустой запрос — null.
 */
create function public.search_tsquery(needle text)
returns tsquery
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  words text[] := regexp_split_to_array(public.search_words(public.search_norm(needle)), ' ');
  word text;
  term text;
  part tsquery;
  result tsquery;
  i int;
begin
  for i in 1 .. coalesce(array_length(words, 1), 0) loop
    word := words[i];
    continue when word = '';

    term := quote_literal(word) || case when i = array_length(words, 1) then ':*' else '' end;
    part := to_tsquery('pg_catalog.russian'::regconfig, term)
         || to_tsquery('pg_catalog.simple'::regconfig, term);
    result := case when result is null then part else result && part end;
  end loop;

  return result;
end;
$$;

-- =============================================================================
-- Разбор запроса и ранг
-- =============================================================================

/**
 * Что спросили. `@` впереди — совпадения по @имени поднимаются выше
 * совпадений по названию. Суффикс `.ch` — только каналы, `.di` — только
 * группы (`kind`), его нет — все виды. `text_query` — для названий и текста
 * сообщений, `username_query` — для @имён: только если запрос и правда похож
 * на имя (латиница, цифры, `_`), иначе null.
 */
create function public.search_parse(query text)
returns table (text_query text, username_query text, by_username boolean, kind text)
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  rest text := btrim(coalesce(query, ''));
  lowered text;
begin
  by_username := rest like '@%';
  rest := btrim(ltrim(rest, '@'));
  lowered := lower(rest);
  kind := null;

  if lowered like '%.ch' then
    kind := 'channel';
    rest := left(rest, -3);
  elsif lowered like '%.di' then
    kind := 'group';
    rest := left(rest, -3);
  end if;

  text_query := public.search_norm(rest);
  username_query := case when lower(rest) ~ '^[a-z0-9_]+$' then lower(rest) end;

  return next;
end;
$$;

/**
 * Уровень совпадения нормализованного поля с нормализованным запросом:
 * 4 — точное, 3 — с начала слова, 2 — внутри слова, 1 — нечёткое (опечатка),
 * 0 — нет. Порог нечёткости — тот же, что у оператора `<%` в функциях
 * поиска (`pg_trgm.word_similarity_threshold`).
 */
create function public.search_level(field text, needle text)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when field is null or needle is null or needle = '' then 0
    when field = needle then 4
    when strpos(' ' || public.search_words(field), ' ' || public.search_words(needle)) > 0
      and public.search_words(needle) <> '' then 3
    when strpos(field, needle) > 0 then 2
    when char_length(needle) >= 4 and extensions.word_similarity(needle, field) >= 0.45 then 1
    else 0
  end
$$;

-- =============================================================================
-- Мои чаты для поиска
-- =============================================================================

/**
 * Чаты, в которых ищет человек: где он участник, и всё, на что он подписан, —
 * чат подписки и чат постов подписанного канала, любого уровня (`in_chats`
 * не важен). Удалённые чаты и каналы — нет. На неё опираются и блок «Чаты»,
 * и блок «Сообщения»: новый вид доступа (модератор канала, участник стрима)
 * добавляется сюда ещё одной веткой union — и сразу виден в обоих.
 *
 * Invoker: свои строки `subscriptions` человек читает сам, `chat_members`,
 * `chats` и `channels` открыты на чтение.
 */
create function public.searchable_chat_ids()
returns table (chat_id uuid)
language sql
stable
set search_path = public
as $$
  select c.id
  from public.chats c
  where c.deleted_at is null
    and c.id in (
      select cm.chat_id from public.chat_members cm where cm.user_id = auth.uid()
      union
      select s.chat_id from public.subscriptions s
      where s.subscriber_id = auth.uid() and s.chat_id is not null
      union
      select ch.posts_chat_id from public.subscriptions s
      join public.channels ch on ch.id = s.channel_id
      where s.subscriber_id = auth.uid()
    )
    and not exists (
      select 1 from public.channels ch
      where ch.posts_chat_id = c.id and ch.deleted_at is not null
    )
$$;

revoke execute on function public.searchable_chat_ids() from public, anon;
grant execute on function public.searchable_chat_ids() to authenticated;

/**
 * Мои чаты так, как их показывает строка выдачи: канал — его названием и
 * @именем, группа — своими, свой диалог — собеседником (он же участник или
 * ещё не принявший заявку), чужой диалог по подписке — «Аня и Пётр».
 * Definer: имя ещё не принявшего заявку закрыто RLS `chat_invites`, а
 * `outsider_chat_title` недоступна клиенту.
 */
create function public.searchable_chats()
returns table (
  chat_id uuid,
  entity_kind text,
  channel_id uuid,
  peer_id uuid,
  title text,
  username text,
  avatar_url text,
  subscribed boolean,
  subscribers_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    case when c.kind = 'channel_posts' then 'channel' else c.kind end,
    ch.id,
    peer.id,
    case
      when ch.id is not null then ch.title
      when nullif(btrim(c.title), '') is not null then c.title
      when c.kind = 'group' then 'Групповой чат'
      when member.chat_id is not null then coalesce(peer.display_name, 'Диалог')
      else public.outsider_chat_title(c.id)
    end,
    coalesce(ch.username, c.username, peer.username),
    coalesce(ch.avatar_url, peer.avatar_url),
    member.chat_id is null,
    coalesce(ch.subscribers_count, c.subscribers_count)
  from public.searchable_chat_ids() ids
  join public.chats c on c.id = ids.chat_id
  left join public.channels ch on ch.posts_chat_id = c.id
  left join public.chat_members member on member.chat_id = c.id and member.user_id = auth.uid()
  left join lateral (
    select p.id, p.display_name, p.username, p.avatar_url
    from (
      select cm.user_id as person, 0 as rank, cm.joined_at as at
      from public.chat_members cm
      where cm.chat_id = c.id and cm.user_id <> auth.uid()
      union all
      select i.invitee_id, 1, i.created_at
      from public.chat_invites i
      where i.chat_id = c.id and i.status <> 'accepted' and i.invitee_id <> auth.uid()
    ) other
    join public.profiles p on p.id = other.person and p.deleted_at is null
    order by other.rank, other.at
    limit 1
  ) peer on c.kind = 'direct' and member.chat_id is not null
$$;

revoke execute on function public.searchable_chats() from public, anon, authenticated;

-- =============================================================================
-- Индексы
-- =============================================================================
--
-- Сущностей немного, а точность важна: триграммы по нормализованному названию
-- и по @имени (подстрока, начало и опечатка одним индексом). Точное и
-- начальное совпадение @имени обслуживает тот же GIN — отдельный btree по
-- `lower(username)` уже есть у уникальных индексов, но LIKE по нему в локали
-- en_US не работает.
--
-- Сообщения — самая горячая таблица: индексы частичные, только живые
-- сообщения с текстом (`text` и подпись `media`). Системные, островки,
-- пересланные комментарии и голосовые в них не попадают — и в выдачу тоже.
-- На облаке в `messages` 375 строк: обычный `create index` занимает
-- миллисекунды. На большой таблице эти два индекса строятся `concurrently`
-- отдельными шагами вне транзакции миграции.

create index channels_search_title_idx
  on public.channels using gin (public.search_norm(title) extensions.gin_trgm_ops)
  where deleted_at is null;

create index channels_search_username_idx
  on public.channels using gin (lower(username) extensions.gin_trgm_ops)
  where deleted_at is null;

create index profiles_search_name_idx
  on public.profiles using gin (public.search_norm(display_name) extensions.gin_trgm_ops)
  where username is not null and deleted_at is null;

create index profiles_search_username_idx
  on public.profiles using gin (lower(username) extensions.gin_trgm_ops)
  where username is not null and deleted_at is null;

create index chats_search_title_idx
  on public.chats using gin (public.search_norm(title) extensions.gin_trgm_ops)
  where kind = 'group' and username is not null and deleted_at is null;

create index chats_search_username_idx
  on public.chats using gin (lower(username) extensions.gin_trgm_ops)
  where kind = 'group' and username is not null and deleted_at is null;

create index messages_search_tsv_idx
  on public.messages using gin (public.search_tsv(text))
  where deleted_at is null and kind in ('text', 'media') and text is not null;

create index messages_search_trgm_idx
  on public.messages using gin (public.search_norm(text) extensions.gin_trgm_ops)
  where deleted_at is null and kind in ('text', 'media') and text is not null;

-- =============================================================================
-- Поиск сущностей: блоки «Чаты» и «Глобальный поиск»
-- =============================================================================

/**
 * Оба блока сущностей одним вызовом, каждый уже упорядочен.
 *
 * `section = 'mine'` — мои чаты и подписки (`searchable_chats`), не больше
 * `mine_limit`. `section = 'global'` — каналы, люди и группы с @именем,
 * которых нет в моих: канал без моей подписки и не мой, группа, где я не
 * участник и не подписчик, человек, с которым у меня нет диалога, и не я сам.
 * Не больше `global_limit`.
 *
 * Ранг: уровень совпадения (`search_level`) по @имени и по названию. С `@`
 * впереди сначала уровень по @имени, потом по названию; без `@` — лучший из
 * двух. Дальше — похожесть, название, id.
 *
 * Definer: блок «Чаты» берёт имена ещё не принявших заявку; глобальный блок
 * фильтрует удалённое явно.
 */
create function public.search_entities(
  query text,
  mine_limit int default 50,
  global_limit int default 20
)
returns table (
  section text,
  entity_kind text,
  id uuid,
  chat_id uuid,
  channel_id uuid,
  peer_id uuid,
  title text,
  username text,
  avatar_url text,
  subscribed boolean,
  subscribers_count int
)
language plpgsql
stable
security definer
set search_path = public, extensions
set pg_trgm.word_similarity_threshold = 0.45
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  q record;
  pattern text;
  fuzzy boolean;
  user_pattern text;
  user_fuzzy boolean;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into q from public.search_parse(query);

  if q.text_query = '' then
    return;
  end if;

  pattern := public.search_like(q.text_query);
  fuzzy := char_length(q.text_query) >= 4;
  user_pattern := case when q.username_query is not null then public.search_like(q.username_query) end;
  user_fuzzy := char_length(q.username_query) >= 4;

  return query
  with mine as (
    select * from public.searchable_chats()
  ),
  mine_ranked as (
    select
      m.*,
      public.search_level(lower(m.username), q.username_query) as u_level,
      public.search_level(public.search_norm(m.title), q.text_query) as t_level
    from mine m
    where q.kind is null or m.entity_kind = q.kind
  ),
  global_candidates as (
    select
      'channel'::text as entity_kind,
      ch.id,
      ch.posts_chat_id as chat_id,
      ch.id as channel_id,
      null::uuid as peer_id,
      ch.title,
      ch.username,
      ch.avatar_url,
      ch.subscribers_count
    from public.channels ch
    where ch.deleted_at is null
      and (q.kind is null or q.kind = 'channel')
      and (
        public.search_norm(ch.title) like pattern
        or (fuzzy and q.text_query <% public.search_norm(ch.title))
        or lower(ch.username) like user_pattern
        or (user_fuzzy and q.username_query <% lower(ch.username))
      )
      and ch.posts_chat_id not in (select m.chat_id from mine m)
    union all
    select
      'group', g.id, g.id, null, null, coalesce(nullif(btrim(g.title), ''), 'Групповой чат'),
      g.username, null, g.subscribers_count
    from public.chats g
    where g.kind = 'group' and g.username is not null and g.deleted_at is null
      and (q.kind is null or q.kind = 'group')
      and (
        public.search_norm(g.title) like pattern
        or (fuzzy and q.text_query <% public.search_norm(g.title))
        or lower(g.username) like user_pattern
        or (user_fuzzy and q.username_query <% lower(g.username))
      )
      and g.id not in (select m.chat_id from mine m)
    union all
    select
      'person', p.id, null, null, p.id, coalesce(p.display_name, p.username), p.username,
      p.avatar_url, null
    from public.profiles p
    where p.username is not null and p.deleted_at is null
      and q.kind is null
      and p.id <> me
      and (
        public.search_norm(p.display_name) like pattern
        or (fuzzy and q.text_query <% public.search_norm(p.display_name))
        or lower(p.username) like user_pattern
        or (user_fuzzy and q.username_query <% lower(p.username))
      )
      -- Человек, с которым у меня диалог, уже стоит в «Чатах» этим диалогом.
      and p.id not in (
        select m.peer_id from mine m where m.peer_id is not null
      )
  ),
  global_ranked as (
    select
      g.*,
      public.search_level(lower(g.username), q.username_query) as u_level,
      public.search_level(public.search_norm(g.title), q.text_query) as t_level
    from global_candidates g
  ),
  both_ranked as (
    select
      'mine'::text as section, r.entity_kind,
      case when r.entity_kind = 'channel' then r.channel_id else r.chat_id end as id,
      r.chat_id, r.channel_id, r.peer_id, r.title, r.username, r.avatar_url,
      r.subscribed, r.subscribers_count, r.u_level, r.t_level
    from mine_ranked r
    where r.u_level > 0 or r.t_level > 0
    union all
    select
      'global', r.entity_kind, r.id, r.chat_id, r.channel_id, r.peer_id, r.title, r.username,
      r.avatar_url, false, r.subscribers_count, r.u_level, r.t_level
    from global_ranked r
    where r.u_level > 0 or r.t_level > 0
  ),
  ordered as (
    select
      b.*,
      row_number() over (
        partition by b.section
        order by
          case when q.by_username then b.u_level else greatest(b.u_level, b.t_level) end desc,
          case when q.by_username then b.t_level else least(b.u_level, b.t_level) end desc,
          greatest(
            extensions.similarity(public.search_norm(b.title), q.text_query),
            coalesce(extensions.similarity(lower(b.username), q.username_query), 0)
          ) desc,
          public.search_norm(b.title),
          b.id
      ) as position
    from both_ranked b
  )
  select
    o.section, o.entity_kind, o.id, o.chat_id, o.channel_id, o.peer_id, o.title, o.username,
    o.avatar_url, o.subscribed, o.subscribers_count
  from ordered o
  where o.position <= case
    when o.section = 'mine' then least(greatest(coalesce(mine_limit, 50), 1), 200)
    else least(greatest(coalesce(global_limit, 20), 1), 100)
  end
  order by o.section desc, o.position;
end;
$$;

revoke execute on function public.search_entities(text, int, int) from public, anon;
grant execute on function public.search_entities(text, int, int) to authenticated;

-- =============================================================================
-- Поиск сообщений: блок «Сообщения»
-- =============================================================================

/**
 * Сообщения и посты моих чатов и подписок (`searchable_chat_ids`), от новых к
 * старым, страницами по ключу (`created_at`, `id`) — без offset.
 *
 * Сначала — слова и их начала (полнотекстовый индекс, морфология) и, с трёх
 * символов, подстрока внутри слова (триграммы). Если по запросу так не нашлось
 * ничего вообще — опечатки (`<%`). Не вперемешку: выдача идёт по дате, и
 * нечёткий мусор между точными совпадениями её бы испортил. Решение
 * принимается на каждой странице одинаково — по наличию хоть одного точного
 * совпадения, поэтому страницы одного запроса не смешивают режимы. `fuzzy` в
 * строке говорит, каким режимом она найдена.
 *
 * `@` и суффикс тип сообщений не сужают: ищется текст запроса без них.
 * Definer: чужие диалоги по подписке называются глазами постороннего.
 */
create function public.search_messages(
  query text,
  before_created timestamptz default null,
  before_id uuid default null,
  page_size int default 30
)
returns table (
  message_id uuid,
  chat_id uuid,
  chat_kind text,
  channel_id uuid,
  chat_title text,
  chat_avatar_url text,
  author_id uuid,
  author_name text,
  text text,
  created_at timestamptz,
  fuzzy boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
set pg_trgm.word_similarity_threshold = 0.45
as $$
#variable_conflict use_column
declare
  needle text;
  tsq tsquery;
  pattern text;
  use_like boolean;
  use_fuzzy boolean := false;
  chat_ids uuid[];
  lim int := least(greatest(coalesce(page_size, 30), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  needle := (select p.text_query from public.search_parse(query) p);

  if needle is null or needle = '' then
    return;
  end if;

  tsq := public.search_tsquery(needle);
  pattern := public.search_like(needle);
  -- Подстрока короче трёх символов триграммный индекс не сужает — прошёл бы
  -- весь индекс. Короткому запросу хватает начала слова.
  use_like := char_length(needle) >= 3;
  chat_ids := array(select s.chat_id from public.searchable_chat_ids() s);

  if char_length(needle) >= 4 and not exists (
    select 1 from public.messages m
    where m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
      and m.chat_id = any (chat_ids)
      and (
        (tsq is not null and public.search_tsv(m.text) @@ tsq)
        or (use_like and public.search_norm(m.text) like pattern)
      )
  ) then
    use_fuzzy := true;
  end if;

  return query
  with hits as (
    select m.id, m.chat_id, m.author_id, m.text, m.created_at
    from public.messages m
    where m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
      and m.chat_id = any (chat_ids)
      and (before_created is null or (m.created_at, m.id) < (before_created, before_id))
      and case
        when use_fuzzy then needle <% public.search_norm(m.text)
        else (tsq is not null and public.search_tsv(m.text) @@ tsq)
          or (use_like and public.search_norm(m.text) like pattern)
      end
    order by m.created_at desc, m.id desc
    limit lim
  ),
  faces as (
    select * from public.searchable_chats() f
    where f.chat_id in (select h.chat_id from hits h)
  )
  select
    f.id,
    f.chat_id,
    face.entity_kind,
    face.channel_id,
    face.title,
    face.avatar_url,
    f.author_id,
    coalesce(p.display_name, p.username, 'Без имени'),
    f.text,
    f.created_at,
    use_fuzzy
  from hits f
  join faces face on face.chat_id = f.chat_id
  left join public.profiles p on p.id = f.author_id
  order by f.created_at desc, f.id desc;
end;
$$;

revoke execute on function public.search_messages(text, timestamptz, uuid, int) from public, anon;
grant execute on function public.search_messages(text, timestamptz, uuid, int) to authenticated;
