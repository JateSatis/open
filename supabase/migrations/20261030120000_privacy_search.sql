-- Приватность, этап 2: «Кто может найти меня в поиске»
-- (`account_search_visibility`) и защита от массового сбора (п. 4.2 ТЗ).
--
-- Зритель без права не находит человека ни в каком поиске: среди людей
-- глобального поиска, в поиске «Нового чата» и приглашения в группу, по его
-- имени — личку с ним у не-участника, и его сообщения — в поиске сообщений
-- и в поиске внутри чата. Участник чата внутри своего чата находит всё, как
-- раньше: он это и так видит. Посты канала публикует канал, а не человек, —
-- они ищутся всегда. Одна проверка — `privacy_allows`, по месту в каждой
-- функции. На этапе 4 сюда добавится «ищется по псевдониму, не ищется по
-- настоящему имени»: имя и @имя здесь сравниваются в одном месте на вид.
--
-- Каталога людей больше нет: пустой запрос «Нового чата» и приглашения
-- отдаёт знакомых — друзей и участников моих личек и групп. Остальных
-- находят только поиском, страницами не больше 50.
--
-- Частота: поиск сущностей, людей и списки друзей ограничены журналом
-- `search_request_log` — 120 в минуту, 1200 в час, 5000 в сутки на человека.
-- Это защита от перебора, а не продуктовый лимит: печатая, человек делает
-- один запрос на паузу после буквы. Отказ — OPN06. Прямое чтение таблиц
-- PostgREST здесь не ограничить.
--
-- Время в выдаче сообщений — как у переписки: null, если время чата скрыто
-- от смотрящего (`chat_time_visible`), курсор страниц — номер `seq`.

-- =============================================================================
-- Частота
-- =============================================================================

create table public.search_request_log (
  id uuid primary key default gen_random_uuid(),
  -- Каскад: журнал — приватные данные аккаунта.
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('entities', 'people', 'friends')),
  created_at timestamptz not null default now()
);

create index search_request_log_user_idx on public.search_request_log (user_id, created_at desc);

alter table public.search_request_log enable row level security;
revoke all on public.search_request_log from anon, authenticated;

/**
 * Засчитать запрос поиска или списка людей. Сверх лимита — OPN06, и запрос
 * не выполняется. Параллельные запросы одного человека встают в очередь на
 * блокировке и видят записи друг друга.
 */
create function public.search_rate_hit(p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('search_requests_of:' || me::text, 0));

  if (select count(*) from public.search_request_log
        where user_id = me and created_at > now() - interval '1 minute') >= 120
    or (select count(*) from public.search_request_log
        where user_id = me and created_at > now() - interval '1 hour') >= 1200
    or (select count(*) from public.search_request_log
        where user_id = me and created_at > now() - interval '1 day') >= 5000
  then
    raise exception 'Слишком много запросов поиска' using errcode = 'OPN06';
  end if;

  insert into public.search_request_log (user_id, kind) values (me, p_kind);
end;
$$;

create function public.purge_search_request_log()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.search_request_log where created_at < now() - interval '2 days';
$$;

revoke execute on function public.search_rate_hit(text) from public, anon, authenticated;
revoke execute on function public.purge_search_request_log() from public, anon, authenticated;

select cron.schedule(
  'purge-search-request-log',
  '41 * * * *',
  $$select public.purge_search_request_log()$$
);

-- =============================================================================
-- Кого я знаю
-- =============================================================================

/** Друзья и участники моих личек и групп, кроме меня. */
create function public.known_people_ids(p_me uuid)
returns table (person_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select case when f.requester_id = p_me then f.addressee_id else f.requester_id end
  from public.friendships f
  where f.status = 'accepted' and (f.requester_id = p_me or f.addressee_id = p_me)
  union
  select them.user_id
  from public.chat_members mine
  join public.chats c on c.id = mine.chat_id and c.kind in ('direct', 'group') and c.deleted_at is null
  join public.chat_members them on them.chat_id = mine.chat_id and them.user_id <> p_me
  where mine.user_id = p_me
$$;

revoke execute on function public.known_people_ids(uuid) from public, anon, authenticated;

-- =============================================================================
-- Чаты, где человек скрывает поиск по себе
-- =============================================================================

/**
 * Чужой диалог, который я читаю подпиской, называется именами участников —
 * и по ним бы находился. Не находится, если хоть один участник закрыл от
 * меня поиск. Свои чаты (я участник) ищутся как раньше.
 */
create function public.chat_found_by_names(p_chat uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.chat_members where chat_id = p_chat and user_id = p_viewer)
    or not exists (
      select 1 from public.chat_members cm
      where cm.chat_id = p_chat
        and not public.privacy_allows('account_search_visibility', cm.user_id, p_viewer)
    )
$$;

revoke execute on function public.chat_found_by_names(uuid, uuid) from public, anon, authenticated;

-- =============================================================================
-- Сущности: «Чаты» и «Глобальный поиск»
-- =============================================================================
--
-- Тело — как в 20261018110000_group_avatar_in_search.sql, плюс: лимит
-- частоты, человек в глобальном блоке — только если пускает меня в поиск,
-- чужой диалог по именам — только если все его участники пускают, страница
-- глобального блока — не больше 30. Volatile: журнал частоты пишется.

create or replace function public.search_entities(
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
volatile
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

  perform public.search_rate_hit('entities');

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
    where (q.kind is null or m.entity_kind = q.kind)
      and (m.entity_kind <> 'direct' or not m.subscribed or public.chat_found_by_names(m.chat_id, me))
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
      g.username, g.avatar_url, g.subscribers_count
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
      and public.privacy_allows('account_search_visibility', p.id, me)
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
    else least(greatest(coalesce(global_limit, 20), 1), 30)
  end
  order by o.section desc, o.position;
end;
$$;

-- =============================================================================
-- Сообщения: блок «Сообщения»
-- =============================================================================

/**
 * Найдётся ли сообщение смотрящему по поиску автора: в своём чате и в чате
 * постов канала — да, иначе — если автор пускает смотрящего в поиск.
 */
create function public.message_found_by_author(p_chat uuid, p_author uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_author is null
    or p_author = p_viewer
    or exists (select 1 from public.chat_members where chat_id = p_chat and user_id = p_viewer)
    or exists (select 1 from public.chats where id = p_chat and kind = 'channel_posts')
    or public.privacy_allows('account_search_visibility', p_author, p_viewer)
$$;

revoke execute on function public.message_found_by_author(uuid, uuid, uuid) from public, anon, authenticated;

drop function public.search_messages(text, timestamptz, uuid, int);

/**
 * Сообщения и посты моих чатов и подписок, от новых к старым, страницами по
 * номеру `seq` — как в 20261016100000_search.sql, плюс поиск автора и время
 * глазами смотрящего.
 */
create function public.search_messages(
  query text,
  before_seq bigint default null,
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
  seq bigint,
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
  me uuid := auth.uid();
  needle text;
  tsq tsquery;
  pattern text;
  use_like boolean;
  use_fuzzy boolean := false;
  chat_ids uuid[];
  open_ids uuid[];
  lim int := least(greatest(coalesce(page_size, 30), 1), 100);
begin
  if me is null then
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
  -- Где автор не важен: мои чаты и чаты постов каналов.
  open_ids := array(
    select c.id from public.chats c
    where c.id = any (chat_ids)
      and (
        c.kind = 'channel_posts'
        or exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.user_id = me)
      )
  );

  if char_length(needle) >= 4 and not exists (
    select 1 from public.messages m
    where m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
      and m.chat_id = any (chat_ids)
      and (
        (tsq is not null and public.search_tsv(m.text) @@ tsq)
        or (use_like and public.search_norm(m.text) like pattern)
      )
      and (
        m.chat_id = any (open_ids)
        or public.message_found_by_author(m.chat_id, m.author_id, me)
      )
  ) then
    use_fuzzy := true;
  end if;

  return query
  with hits as (
    select m.id, m.chat_id, m.author_id, m.text, m.seq, m.created_at
    from public.messages m
    where m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
      and m.chat_id = any (chat_ids)
      and (before_seq is null or m.seq < before_seq)
      and case
        when use_fuzzy then needle <% public.search_norm(m.text)
        else (tsq is not null and public.search_tsv(m.text) @@ tsq)
          or (use_like and public.search_norm(m.text) like pattern)
      end
      and (
        m.chat_id = any (open_ids)
        or public.message_found_by_author(m.chat_id, m.author_id, me)
      )
    order by m.seq desc
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
    f.seq,
    case when public.chat_time_visible(f.chat_id) then f.created_at end,
    use_fuzzy
  from hits f
  join faces face on face.chat_id = f.chat_id
  left join public.profiles p on p.id = f.author_id
  order by f.seq desc;
end;
$$;

revoke execute on function public.search_messages(text, bigint, int) from public, anon;
grant execute on function public.search_messages(text, bigint, int) to authenticated;

-- =============================================================================
-- Поиск внутри чата
-- =============================================================================

drop function public.search_chat_messages(uuid, text, timestamptz, uuid, int);

/**
 * Совпадения в одном чате, свежие сверху, страницей по номеру. Участник и
 * чат постов — всё; посетитель — без сообщений тех, кто закрыл от него поиск.
 */
create function public.search_chat_messages(
  target_chat uuid,
  query text,
  before_seq bigint default null,
  page_size int default 30
)
returns table (
  message_id uuid,
  seq bigint,
  author_id uuid,
  author_name text,
  text text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  needle text;
  tsq tsquery;
  pattern text;
  use_like boolean;
  open_chat boolean;
  visible boolean;
  lim int := least(greatest(coalesce(page_size, 30), 1), 100);
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  needle := public.search_norm(query);

  if needle is null or needle = '' then
    return;
  end if;

  select
    c.kind = 'channel_posts'
      or exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.user_id = me)
  into open_chat
  from public.chats c
  where c.id = target_chat and c.deleted_at is null;

  if open_chat is null then
    return;
  end if;

  tsq := public.search_tsquery(needle);
  pattern := public.search_like(needle);
  use_like := char_length(needle) >= 3;
  visible := public.chat_time_visible(target_chat);

  return query
  select
    m.id, m.seq, m.author_id, coalesce(p.display_name, p.username), m.text,
    case when visible then m.created_at end
  from public.messages m
  left join public.profiles p on p.id = m.author_id
  where m.chat_id = target_chat
    and m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
    and (before_seq is null or m.seq < before_seq)
    and (
      (tsq is not null and public.search_tsv(m.text) @@ tsq)
      or (use_like and public.search_norm(m.text) like pattern)
    )
    and (open_chat or public.message_found_by_author(m.chat_id, m.author_id, me))
  order by m.seq desc
  limit lim;
end;
$$;

revoke execute on function public.search_chat_messages(uuid, text, bigint, int) from public, anon;
grant execute on function public.search_chat_messages(uuid, text, bigint, int) to authenticated;

/** Сколько всего совпадений в чате — с тем же фильтром, что у выдачи; не дальше 1000. */
create or replace function public.count_chat_search(target_chat uuid, query text)
returns int
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  me uuid := auth.uid();
  needle text;
  tsq tsquery;
  pattern text;
  use_like boolean;
  open_chat boolean;
  total int;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  needle := public.search_norm(query);

  if needle is null or needle = '' then
    return 0;
  end if;

  select
    c.kind = 'channel_posts'
      or exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.user_id = me)
  into open_chat
  from public.chats c
  where c.id = target_chat and c.deleted_at is null;

  if open_chat is null then
    return 0;
  end if;

  tsq := public.search_tsquery(needle);
  pattern := public.search_like(needle);
  use_like := char_length(needle) >= 3;

  select count(*) into total
  from (
    select 1
    from public.messages m
    where m.chat_id = target_chat
      and m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
      and (
        (tsq is not null and public.search_tsv(m.text) @@ tsq)
        or (use_like and public.search_norm(m.text) like pattern)
      )
      and (open_chat or public.message_found_by_author(m.chat_id, m.author_id, me))
    limit 1000
  ) hits;

  return total;
end;
$$;

-- =============================================================================
-- Люди: «Новый чат» и приглашение в группу
-- =============================================================================

/**
 * Пустой запрос — знакомые: друзья и участники моих личек и групп. Запрос —
 * знакомые с совпадением и остальные, кто пускает меня в поиск. Страница по
 * алфавиту, не больше 50; курсор — имя и id последнего. Себя и удалённых
 * нет.
 */
create or replace function public.search_people(
  query text default null,
  after_name text default null,
  after_id uuid default null,
  page_size int default 30
)
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  needle text := public.search_norm(coalesce(query, ''));
  pattern text;
  user_pattern text;
  lim int := least(greatest(coalesce(page_size, 30), 1), 50);
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  perform public.search_rate_hit('people');

  pattern := case when needle <> '' then public.search_like(needle) end;
  user_pattern := case
    when needle <> '' then public.search_like(lower(ltrim(btrim(query), '@')))
  end;

  return query
  with known as (
    select k.person_id from public.known_people_ids(me) k
  )
  select p.id, p.display_name, p.username, p.avatar_url
  from public.profiles p
  where p.deleted_at is null
    and p.id <> me
    and (
      (pattern is null and p.id in (select person_id from known))
      or (
        pattern is not null
        and (
          public.search_norm(p.display_name) like pattern
          or lower(p.username) like user_pattern
        )
        and (
          p.id in (select person_id from known)
          or public.privacy_allows('account_search_visibility', p.id, me)
        )
      )
    )
    and (
      after_id is null
      or (coalesce(p.display_name, ''), p.id) > (coalesce(after_name, ''), after_id)
    )
  order by coalesce(p.display_name, ''), p.id
  limit lim;
end;
$$;

-- =============================================================================
-- Друзья человека — с лимитом частоты
-- =============================================================================

create or replace function public.list_friends(
  p_user uuid,
  p_limit int default 30,
  p_before_accepted_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  friendship_id uuid,
  accepted_at timestamptz,
  user_id uuid,
  display_name text,
  username text,
  avatar_url text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not public.privacy_allows('friends_list_visibility', p_user, me) then
    raise exception 'Список друзей скрыт' using errcode = '42501';
  end if;

  -- Свой список — не сбор чужих данных.
  if p_user <> me then
    perform public.search_rate_hit('friends');
  end if;

  return query
  select f.id, f.accepted_at, p.id, p.display_name, p.username, p.avatar_url
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = p_user then f.addressee_id else f.requester_id end
   and p.deleted_at is null
  where f.status = 'accepted'
    and (f.requester_id = p_user or f.addressee_id = p_user)
    and (
      p_before_accepted_at is null
      or (f.accepted_at, f.id) < (p_before_accepted_at, p_before_id)
    )
  order by f.accepted_at desc, f.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- =============================================================================
-- Недавние поиска: перепроверка сохранённого на телефоне
-- =============================================================================

/**
 * Что из сохранённых на телефоне результатов ещё можно показать: человека —
 * если он по-прежнему пускает меня в поиск, сообщение — если оно живо и
 * находится мне по тем же правилам, с временем глазами смотрящего сейчас.
 * Нет строки — нельзя.
 */
create function public.recheck_recent_searches(person_ids uuid[], message_ids uuid[])
returns table (kind text, id uuid, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if coalesce(cardinality(person_ids), 0) > 50 or coalesce(cardinality(message_ids), 0) > 50 then
    raise exception 'Слишком много за раз' using errcode = '22023';
  end if;

  return query
  select 'person'::text, p.id, null::timestamptz
  from public.profiles p
  where p.id = any (coalesce(person_ids, '{}'))
    and p.deleted_at is null
    and public.privacy_allows('account_search_visibility', p.id, me)
  union all
  select 'message', m.id, case when public.chat_time_visible(m.chat_id) then m.created_at end
  from public.messages m
  where m.id = any (coalesce(message_ids, '{}'))
    and m.deleted_at is null
    and m.chat_id in (select s.chat_id from public.searchable_chat_ids() s)
    and public.message_found_by_author(m.chat_id, m.author_id, me);
end;
$$;

revoke execute on function public.recheck_recent_searches(uuid[], uuid[]) from public, anon;
grant execute on function public.recheck_recent_searches(uuid[], uuid[]) to authenticated;
