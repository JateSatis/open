-- Сохранённые сообщения — личное место человека для нужного из любых чатов.
--
-- Не чат и не `messages`: иначе включилась бы публичная модель. Три закрытые
-- таблицы — сохранённые копии, их вложения и теги со связями. Читает только
-- владелец, пишут только функции.
--
-- Сохранённое — копия, как в Telegram: снимок того, что человек видел в
-- момент сохранения (текст, вложения, время — глазами смотрящего, из
-- `message_rows` / `comment_rows` и представлений вложений). Правка, удаление
-- и блокировка автором оригинала копию не меняют. Файлы в Storage не
-- копируются: копия ссылается на те же пути, а читать их владельцу копии
-- разрешает `chat_media_object_readable` (ветка ниже). Приложение медиа
-- сообщений физически не удаляет.
--
-- Удаление из сохранённого (этап 2) — физическое: это личная закладка, а не
-- публичный контент, как отписка в `subscriptions`.

-- ------------------------------------------------------------------ таблицы

create table public.saved_tags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  -- Номер цвета палитры клиента (`src/theme`): назначается по кругу.
  color smallint not null,
  -- Сколько сохранённых с этим тегом — для «10 самых используемых». Пишет триггер.
  uses_count integer not null default 0,
  constraint saved_tags_name check (name = btrim(name) and name <> ''),
  constraint saved_tags_color check (color between 0 and 11),
  constraint saved_tags_uses check (uses_count >= 0),
  -- Цель составного ключа связи: тег привязывается только к своему сохранённому.
  constraint saved_tags_id_owner_key unique (id, owner_id)
);

create unique index saved_tags_owner_name_key on public.saved_tags (owner_id, lower(name));
create index saved_tags_owner_uses_idx on public.saved_tags (owner_id, uses_count desc, created_at desc);

comment on table public.saved_tags is
  'Теги сохранённых сообщений человека. Читает только владелец, пишет create_saved_tag.';

create table public.saved_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Курсор страниц и порядок: несколько сообщений одного сохранения встают
  -- по порядку на экране, а время у них одно.
  seq bigint generated always as identity,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  source_type text not null,
  -- Чат оригинала (у островка — чат первоисточника); у комментария к попу —
  -- чат постов канала.
  source_chat_id uuid references public.chats (id) on delete set null,
  source_message_id uuid references public.messages (id) on delete set null,
  source_comment_id uuid references public.comments (id) on delete set null,
  -- Номер сообщения для перехода: самого сообщения или того, под которым
  -- оставлен комментарий.
  source_seq bigint,
  -- Под чем оставлен комментарий: сообщение или поп.
  comment_message_id uuid references public.messages (id) on delete set null,
  comment_pop_id uuid references public.pops (id) on delete set null,
  -- Откуда, на момент сохранения: канал, чат, где я участник, чужой чат.
  -- Для фильтра по источнику.
  source_category text not null,
  -- Снимок содержимого.
  kind text not null,
  text text,
  -- Автор оригинала — только если при сохранении он был виден мне своим id;
  -- подменённый в диалоге остаётся снимком имени (`author_name`), без id.
  -- Показывается глазами владельца через `person_card`. Клиенту колонка не
  -- читается.
  author_id uuid references public.profiles (id) on delete set null,
  author_opaque boolean not null default false,
  author_name text,
  -- Время оригинала, если оно было видно мне при сохранении.
  original_at timestamptz,
  -- Пост с попом: для фильтра по типу и перехода.
  pop_id uuid references public.pops (id) on delete set null,
  watch_later_at timestamptz,
  watch_done_at timestamptz,
  constraint saved_messages_source_type check (source_type in ('message', 'comment')),
  constraint saved_messages_category check (source_category in ('channel', 'member', 'visitor')),
  constraint saved_messages_kind check (kind in ('text', 'media', 'voice', 'video_note', 'photo', 'video')),
  constraint saved_messages_comment_source check (
    source_type = 'comment' or (source_comment_id is null and comment_message_id is null and comment_pop_id is null)
  ),
  constraint saved_messages_watch check (watch_done_at is null or watch_later_at is not null),
  constraint saved_messages_id_owner_key unique (id, owner_id)
);

create index saved_messages_owner_seq_idx on public.saved_messages (owner_id, seq desc);
create index saved_messages_watch_idx on public.saved_messages (owner_id, watch_later_at)
  where watch_later_at is not null;
create index saved_messages_watch_pending_idx on public.saved_messages (owner_id)
  where watch_later_at is not null and watch_done_at is null;
create index saved_messages_owner_created_idx on public.saved_messages (owner_id, created_at);

comment on table public.saved_messages is
  'Сохранённые копии сообщений и комментариев. Видит только владелец; копия не меняется с оригиналом.';

create table public.saved_message_attachments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  saved_id uuid not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  position integer not null,
  -- Путь в бакете (как у вложений сообщения) или адрес файла попа. `null` —
  -- автор скрыл медиа от меня, когда я сохранял: плитка «скрыто автором».
  url text,
  poster_url text,
  mime_type text,
  width integer,
  height integer,
  duration_ms integer,
  waveform smallint[],
  media_hidden boolean not null default false,
  -- Пост с попом: снимок попа.
  pop_id uuid references public.pops (id) on delete set null,
  pop_channel_id uuid references public.channels (id) on delete set null,
  pop_title text,
  constraint saved_message_attachments_saved_fkey foreign key (saved_id, owner_id)
    references public.saved_messages (id, owner_id) on delete cascade,
  constraint saved_message_attachments_position check (position >= 0),
  constraint saved_message_attachments_file check (media_hidden or url is not null),
  constraint saved_message_attachments_dims check (
    (width is null or width > 0) and (height is null or height > 0) and (duration_ms is null or duration_ms >= 0)
  ),
  constraint saved_message_attachments_position_key unique (saved_id, position)
);

-- Чтение файла в закрытом бакете ищет путь среди копий владельца.
create index saved_message_attachments_url_idx on public.saved_message_attachments (url)
  where url is not null;
create index saved_message_attachments_poster_idx on public.saved_message_attachments (poster_url)
  where poster_url is not null;

comment on table public.saved_message_attachments is
  'Снимок вложений сохранённого: те же пути в Storage, что у оригинала. Видит только владелец.';

create table public.saved_message_tags (
  saved_id uuid not null,
  tag_id uuid not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (saved_id, tag_id),
  -- Чужой тег к своему сохранённому (и наоборот) не привязать: оба ключа — с владельцем.
  constraint saved_message_tags_saved_fkey foreign key (saved_id, owner_id)
    references public.saved_messages (id, owner_id) on delete cascade,
  constraint saved_message_tags_tag_fkey foreign key (tag_id, owner_id)
    references public.saved_tags (id, owner_id) on delete cascade
);

create index saved_message_tags_tag_idx on public.saved_message_tags (tag_id, saved_id);

comment on table public.saved_message_tags is
  'Теги сохранённых. Видит только владелец, пишут функции сохранения.';

-- ------------------------------------------------------------------- доступ

alter table public.saved_tags enable row level security;
alter table public.saved_messages enable row level security;
alter table public.saved_message_attachments enable row level security;
alter table public.saved_message_tags enable row level security;

create policy saved_tags_select_own on public.saved_tags
  for select to authenticated using (owner_id = (select auth.uid()));
create policy saved_messages_select_own on public.saved_messages
  for select to authenticated using (owner_id = (select auth.uid()));
create policy saved_message_attachments_select_own on public.saved_message_attachments
  for select to authenticated using (owner_id = (select auth.uid()));
create policy saved_message_tags_select_own on public.saved_message_tags
  for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.saved_tags, public.saved_messages, public.saved_message_attachments,
  public.saved_message_tags from anon, authenticated;

grant select on public.saved_tags, public.saved_message_attachments, public.saved_message_tags
  to authenticated;
-- Автор — только глазами владельца (`list_saved_messages`), не сырым id.
grant select (
  id, created_at, seq, owner_id, source_type, source_chat_id, source_message_id, source_comment_id,
  source_seq, comment_message_id, comment_pop_id, source_category, kind, text, author_opaque,
  original_at, pop_id, watch_later_at, watch_done_at
) on public.saved_messages to authenticated;

-- ------------------------------------------------------------ счётчик тегов

create function public.saved_tags_count_uses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.saved_tags set uses_count = uses_count + 1 where id = new.tag_id;
  else
    update public.saved_tags set uses_count = greatest(uses_count - 1, 0) where id = old.tag_id;
  end if;

  return null;
end;
$$;

revoke execute on function public.saved_tags_count_uses() from public, anon, authenticated;

create trigger saved_message_tags_count
  after insert or delete on public.saved_message_tags
  for each row execute function public.saved_tags_count_uses();

-- ---------------------------------------------------------------------- теги

-- Новый тег или уже существующий с тем же именем без учёта регистра: повтор
-- просто выбирает его. Цвет — по кругу из 12 цветов палитры.
create function public.create_saved_tag(p_name text)
returns table (id uuid, name text, color smallint, uses_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  clean text := btrim(coalesce(p_name, ''));
  existing public.saved_tags;
  total integer;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Длина имени — продуктовый лимит клиента; здесь — только защита от мусора.
  if clean = '' or char_length(clean) > 100 then
    raise exception 'bad tag name' using errcode = '22023';
  end if;

  -- Два «+» одновременно не создают двух тегов с одним цветом.
  perform pg_advisory_xact_lock(hashtextextended('saved_tags:' || caller::text, 0));

  select * into existing from public.saved_tags t
  where t.owner_id = caller and lower(t.name) = lower(clean);

  if existing.id is not null then
    return query select existing.id, existing.name, existing.color, existing.uses_count;
    return;
  end if;

  select count(*) into total from public.saved_tags t where t.owner_id = caller;

  if total >= 500 then
    raise exception 'too many tags' using errcode = '22023';
  end if;

  return query
  insert into public.saved_tags as t (owner_id, name, color)
  values (caller, clean, (total % 12)::smallint)
  returning t.id, t.name, t.color, t.uses_count;
end;
$$;

revoke execute on function public.create_saved_tag(text) from public, anon;
grant execute on function public.create_saved_tag(text) to authenticated;

-- Свои теги для сохранения: все без дублей, иначе — отказ.
create function public.saved_tags_checked(p_owner uuid, p_tag_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ids uuid[];
begin
  select coalesce(array_agg(distinct t.id), '{}') into ids
  from unnest(coalesce(p_tag_ids, '{}')) as t(id)
  where t.id is not null;

  if exists (
    select 1 from unnest(ids) as t(id)
    where not exists (select 1 from public.saved_tags g where g.id = t.id and g.owner_id = p_owner)
  ) then
    raise exception 'tag not found' using errcode = '42501';
  end if;

  return ids;
end;
$$;

revoke execute on function public.saved_tags_checked(uuid, uuid[]) from public, anon, authenticated;

-- Откуда сохраняют: канал, чат, где я участник, или чужой.
create function public.saved_category(p_chat uuid, p_viewer uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (select c.kind from public.chats c where c.id = p_chat) = 'channel_posts' then 'channel'
    when exists (select 1 from public.chat_members m where m.chat_id = p_chat and m.user_id = p_viewer)
      then 'member'
    else 'visitor'
  end
$$;

revoke execute on function public.saved_category(uuid, uuid) from public, anon, authenticated;

-- Теги и журнал одной сохранённой копии.
create function public.saved_finish(p_saved uuid, p_owner uuid, p_tags uuid[], p_subject_type text, p_subject uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.saved_messages;
begin
  insert into public.saved_message_tags (saved_id, tag_id, owner_id)
  select p_saved, t.id, p_owner from unnest(p_tags) as t(id);

  select * into s from public.saved_messages where id = p_saved;

  -- Сигнал интереса для рекомендаций; теги — личное, в журнал не идут.
  perform public.rec_log(p_owner, 'saved', p_subject_type, p_subject, jsonb_build_object(
    'saved_id', s.id,
    'chat_id', s.source_chat_id,
    'chat_kind', (select c.kind from public.chats c where c.id = s.source_chat_id),
    'category', s.source_category,
    'kind', s.kind,
    'pop_id', coalesce(s.pop_id, s.comment_pop_id),
    'watch_later', s.watch_later_at is not null
  ));
end;
$$;

revoke execute on function public.saved_finish(uuid, uuid, uuid[], text, uuid)
  from public, anon, authenticated;

-- Копия комментария, видимого смотрящему (`comment_rows`): текст, вложения,
-- автор и время — как он их видит.
create function public.saved_insert_comment(p_owner uuid, p_comment uuid, p_tags uuid[], p_watch boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  seen public.comment_rows;
  raw public.comments;
  saved uuid;
begin
  select * into seen from public.comment_rows x where x.id = p_comment and x.deleted_at is null;
  select * into raw from public.comments c where c.id = p_comment;

  if seen.id is null or raw.id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  insert into public.saved_messages (
    owner_id, source_type, source_chat_id, source_comment_id, source_seq, comment_message_id,
    comment_pop_id, source_category, kind, text, author_id, author_opaque, author_name,
    original_at, watch_later_at
  ) values (
    p_owner, 'comment', raw.chat_id, raw.id,
    (select m.seq from public.message_rows m where m.id = raw.message_id),
    raw.message_id, raw.pop_id,
    public.saved_category(raw.chat_id, p_owner),
    case when raw.kind in ('media', 'voice') then raw.kind else 'text' end,
    seen.text,
    case when coalesce(seen.author_opaque, false) then null else raw.author_id end,
    coalesce(seen.author_opaque, false),
    seen.author_name,
    seen.created_at,
    case when p_watch then now() end
  ) returning id into saved;

  insert into public.saved_message_attachments (
    saved_id, owner_id, position, url, poster_url, mime_type, width, height, duration_ms,
    waveform, media_hidden
  )
  select saved, p_owner, a.position, a.url, a.poster_url, a.mime_type, a.width, a.height,
    a.duration_ms, a.waveform, coalesce(a.media_hidden, false)
  from public.comment_attachment_rows a
  where a.comment_id = raw.id;

  perform public.saved_finish(saved, p_owner, p_tags, 'comment', raw.id);

  return saved;
end;
$$;

revoke execute on function public.saved_insert_comment(uuid, uuid, uuid[], boolean)
  from public, anon, authenticated;

-- Копия сообщения, видимого смотрящему (`message_rows`). Источник — чат
-- самого сообщения: у облачка островка это первоисточник.
create function public.saved_insert_message(p_owner uuid, p_message uuid, p_tags uuid[], p_watch boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  seen public.message_rows;
  raw public.messages;
  saved uuid;
  pop uuid;
begin
  select * into seen from public.message_rows x where x.id = p_message;
  select * into raw from public.messages m where m.id = p_message;

  select a.pop_id into pop from public.attachments a
  where a.message_id = raw.id and a.pop_id is not null
  limit 1;

  insert into public.saved_messages (
    owner_id, source_type, source_chat_id, source_message_id, source_seq, source_category,
    kind, text, author_id, author_opaque, author_name, original_at, pop_id, watch_later_at
  ) values (
    p_owner, 'message', raw.chat_id, raw.id, raw.seq,
    public.saved_category(raw.chat_id, p_owner),
    seen.kind, seen.text,
    case when coalesce(seen.author_opaque, false) then null else raw.author_id end,
    coalesce(seen.author_opaque, false),
    seen.author_name,
    seen.created_at,
    pop,
    case when p_watch then now() end
  ) returning id into saved;

  insert into public.saved_message_attachments (
    saved_id, owner_id, position, url, poster_url, mime_type, width, height, duration_ms,
    waveform, media_hidden, pop_id, pop_channel_id, pop_title
  )
  select saved, p_owner, a.position,
    coalesce(p.url, a.url), coalesce(p.poster_url, a.poster_url), coalesce(p.mime_type, a.mime_type),
    coalesce(p.width, a.width), coalesce(p.height, a.height), coalesce(p.duration_ms, a.duration_ms),
    a.waveform,
    -- Удалённый поп: файлов нет — плитка как у скрытого.
    case when a.pop_id is not null then p.id is null else coalesce(a.media_hidden, false) end,
    a.pop_id, p.channel_id, p.title
  from public.attachment_rows a
  left join public.pops p on p.id = a.pop_id and p.deleted_at is null
  where a.message_id = raw.id;

  perform public.saved_finish(saved, p_owner, p_tags, 'message', raw.id);

  return saved;
end;
$$;

revoke execute on function public.saved_insert_message(uuid, uuid, uuid[], boolean)
  from public, anon, authenticated;

-- ------------------------------------------------------------------ сохранение

-- Сохранить сообщения, как их видно в `source_chat` (у островка — чат, где он
-- стоит), каждое отдельной копией, в порядке на экране. Что человек может
-- переслать, то и может сохранить: проверки — как у `forward_messages`, без
-- права писать куда-то. Пересланный комментарий сохраняется как его
-- комментарий.
create function public.save_messages(
  p_source_chat uuid,
  p_message_ids uuid[],
  p_tag_ids uuid[] default '{}',
  p_watch_later boolean default false
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  ids uuid[];
  tags uuid[];
  wanted int;
  item record;
  saved uuid[] := '{}';
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_source_chat is null or not public.chat_readable(p_source_chat) then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;

  tags := public.saved_tags_checked(caller, p_tag_ids);

  select array_agg(u.id order by u.ord) into ids
  from (
    select distinct on (t.id) t.id, t.ord
    from unnest(p_message_ids) with ordinality as t(id, ord)
    where t.id is not null
    order by t.id, t.ord
  ) u;

  wanted := coalesce(cardinality(ids), 0);

  if wanted = 0 then
    raise exception 'nothing to save' using errcode = '22023';
  end if;

  if wanted > 100 then
    raise exception 'too many messages in one call' using errcode = '22023';
  end if;

  -- Видно ли смотрящему: живое, чат читается, не ниже водораздела для
  -- зрителя — ровно то, что отдаёт `message_rows`.
  if (select count(*) from public.message_rows r where r.id = any (ids)) <> wanted then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.messages where id = any (ids) and kind = 'system') then
    raise exception 'system messages cannot be saved' using errcode = '22023';
  end if;

  if exists (select 1 from public.messages where id = any (ids) and kind = 'forward') then
    raise exception 'forwards are not messages: save their originals' using errcode = '22023';
  end if;

  -- Заглушка сообщения заблокировавшего — как будто его нет.
  if exists (select 1 from public.message_rows r where r.id = any (ids) and r.hidden) then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from unnest(ids) as t(id)
    where not public.message_shown_in_chat(t.id, p_source_chat, null)
      and public.forward_holding(t.id, p_source_chat) is null
  ) then
    raise exception 'messages must come from the source chat' using errcode = '42501';
  end if;

  for item in
    select t.id, t.ord, m.kind, m.forwarded_comment_id
    from unnest(ids) with ordinality as t(id, ord)
    join public.messages m on m.id = t.id
    order by t.ord
  loop
    if item.kind = 'comment_forward' then
      if item.forwarded_comment_id is null then
        raise exception 'comment not found' using errcode = 'P0002';
      end if;

      saved := saved || public.saved_insert_comment(caller, item.forwarded_comment_id, tags, coalesce(p_watch_later, false));
    else
      saved := saved || public.saved_insert_message(caller, item.id, tags, coalesce(p_watch_later, false));
    end if;
  end loop;

  return saved;
end;
$$;

revoke execute on function public.save_messages(uuid, uuid[], uuid[], boolean) from public, anon;
grant execute on function public.save_messages(uuid, uuid[], uuid[], boolean) to authenticated;

-- Сохранить комментарии (к сообщению или попу), каждый отдельной копией, по порядку.
create function public.save_comments(
  p_comment_ids uuid[],
  p_tag_ids uuid[] default '{}',
  p_watch_later boolean default false
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  ids uuid[];
  tags uuid[];
  wanted int;
  item record;
  saved uuid[] := '{}';
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  tags := public.saved_tags_checked(caller, p_tag_ids);

  select array_agg(u.id order by u.ord) into ids
  from (
    select distinct on (t.id) t.id, t.ord
    from unnest(p_comment_ids) with ordinality as t(id, ord)
    where t.id is not null
    order by t.id, t.ord
  ) u;

  wanted := coalesce(cardinality(ids), 0);

  if wanted = 0 then
    raise exception 'nothing to save' using errcode = '22023';
  end if;

  if wanted > 100 then
    raise exception 'too many comments in one call' using errcode = '22023';
  end if;

  if (
    select count(*) from public.comment_rows r where r.id = any (ids) and r.deleted_at is null
  ) <> wanted then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  for item in
    select t.id from unnest(ids) with ordinality as t(id, ord) order by t.ord
  loop
    saved := saved || public.saved_insert_comment(caller, item.id, tags, coalesce(p_watch_later, false));
  end loop;

  return saved;
end;
$$;

revoke execute on function public.save_comments(uuid[], uuid[], boolean) from public, anon;
grant execute on function public.save_comments(uuid[], uuid[], boolean) to authenticated;

-- ------------------------------------------------------------------- чтение

-- Страница сохранённого, новыми вперёд, курсор — `seq`. Автор — глазами
-- владельца сейчас (`person_card` в чате оригинала); подменённый при
-- сохранении — снимком имени. Вложения и теги — той же строкой.
create function public.list_saved_messages(p_before_seq bigint default null, p_limit integer default 30)
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
  attachments jsonb,
  tag_ids uuid[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id, s.seq, s.created_at, s.source_type, s.source_category, s.source_chat_id,
    s.source_message_id, s.source_comment_id, s.source_seq, s.comment_message_id, s.comment_pop_id,
    s.kind, s.text,
    case when s.author_opaque then null else p.id end,
    case when s.author_opaque then s.author_name else p.display_name end,
    case when s.author_opaque then null else p.avatar_url end,
    s.author_opaque or coalesce(p.opaque, false),
    s.original_at, s.pop_id, s.watch_later_at, s.watch_done_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'url', a.url, 'poster_url', a.poster_url, 'mime_type', a.mime_type,
        'width', a.width, 'height', a.height, 'duration_ms', a.duration_ms,
        'waveform', a.waveform, 'media_hidden', a.media_hidden, 'pop_id', a.pop_id,
        'pop_channel_id', a.pop_channel_id, 'pop_title', a.pop_title
      ) order by a.position)
      from public.saved_message_attachments a
      where a.saved_id = s.id
    ), '[]'::jsonb),
    coalesce((
      select array_agg(t.tag_id order by t.created_at, t.tag_id)
      from public.saved_message_tags t
      where t.saved_id = s.id
    ), '{}')
  from public.saved_messages s
  left join lateral (
    select c.* from public.person_card(s.author_id, auth.uid(), s.source_chat_id) c
    where s.author_id is not null
  ) p on true
  where s.owner_id = auth.uid()
    and (p_before_seq is null or s.seq < p_before_seq)
  order by s.seq desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

revoke execute on function public.list_saved_messages(bigint, integer) from public, anon;
grant execute on function public.list_saved_messages(bigint, integer) to authenticated;

-- Сводка для строки «Сохранённые» в «Чатах»: сколько не выполнено в «Посмотреть позже».
create function public.saved_summary()
returns table (watch_later_pending integer)
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.saved_messages s
  where s.owner_id = auth.uid() and s.watch_later_at is not null and s.watch_done_at is null
$$;

revoke execute on function public.saved_summary() from public, anon;
grant execute on function public.saved_summary() to authenticated;

-- Куда ведёт тап по источнику копии: оригинал жив (`live`), удалён или
-- недоступен (`original_gone` — чат открыть можно), недоступен и сам чат
-- (`chat_gone`). Решает база, а не догадка клиента.
create function public.saved_source(p_saved uuid)
returns table (
  state text,
  chat_id uuid,
  channel_id uuid,
  message_id uuid,
  seq bigint,
  comment_id uuid,
  pop_id uuid,
  pop_channel_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.saved_messages;
begin
  select * into s from public.saved_messages x where x.id = p_saved and x.owner_id = auth.uid();

  if s.id is null then
    raise exception 'saved message not found' using errcode = 'P0002';
  end if;

  chat_id := s.source_chat_id;
  channel_id := (select ch.id from public.channels ch where ch.posts_chat_id = s.source_chat_id);

  if s.source_chat_id is null or not public.chat_readable(s.source_chat_id) then
    state := 'chat_gone';
    chat_id := null;
    channel_id := null;
    return next;
    return;
  end if;

  if s.source_type = 'message' then
    if exists (
      select 1 from public.message_rows r where r.id = s.source_message_id and not r.hidden
    ) then
      state := 'live';
      message_id := s.source_message_id;
      seq := (select m.seq from public.messages m where m.id = s.source_message_id);
    else
      state := 'original_gone';
    end if;

    return next;
    return;
  end if;

  if exists (
    select 1 from public.comment_rows r where r.id = s.source_comment_id and r.deleted_at is null
  ) then
    state := 'live';
    comment_id := s.source_comment_id;
    message_id := (select r.id from public.message_rows r where r.id = s.comment_message_id);
    seq := (select r.seq from public.message_rows r where r.id = s.comment_message_id);
    pop_id := (select p.id from public.pops p where p.id = s.comment_pop_id and p.deleted_at is null);
    pop_channel_id := (select p.channel_id from public.pops p where p.id = pop_id);

    -- Сообщения под комментарием уже нет — шит не на чем открыть.
    if s.comment_message_id is not null and message_id is null then
      state := 'original_gone';
      comment_id := null;
    end if;

    if s.comment_pop_id is not null and pop_id is null then
      state := 'original_gone';
      comment_id := null;
    end if;
  else
    state := 'original_gone';
  end if;

  return next;
end;
$$;

revoke execute on function public.saved_source(uuid) from public, anon;
grant execute on function public.saved_source(uuid) to authenticated;

-- ------------------------------------------------------- файлы сохранённого

-- Файл закрытого бакета читает и тот, у кого он в сохранённом: копия не
-- меняется с оригиналом, и его удаление или скрытие медиа автором файл у
-- копии не отнимает. В копию путь попадает, только если был открыт
-- сохраняющему (снимок `attachment_rows` / `comment_attachment_rows`).
create or replace function public.chat_media_object_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.attachments a
      cross join lateral public.attachment_access(a.message_id) x(visible, shown)
      where (a.url = p_name or a.poster_url = p_name) and x.visible and x.shown
    )
    or exists (
      select 1
      from public.comment_attachments a
      cross join lateral public.comment_attachment_access(a.comment_id) x(visible, shown)
      where (a.url = p_name or a.poster_url = p_name) and x.visible and x.shown
    )
    or exists (
      select 1 from public.saved_message_attachments s
      where s.url = p_name and s.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.saved_message_attachments s
      where s.poster_url = p_name and s.owner_id = auth.uid()
    )
  )
$$;
