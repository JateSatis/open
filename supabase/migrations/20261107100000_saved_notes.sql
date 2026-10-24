-- Сохранённые сообщения, этап 3: свои заметки и ответы на записи.
--
-- Заметка — запись «Сохранённых», написанная самим владельцем: та же
-- `saved_messages` с `source_type = 'note'`, без источника. Поэтому теги,
-- «Посмотреть позже», закрепы, удаление и страницы работают с ней без второй
-- модели. Видит только владелец, пишут только функции.
--
-- Файлы заметки — очищенные файлы владельца в `chat-media` (`media_objects`),
-- как у вложений сообщения: чужой или неочищенный путь не принимается.
-- Заметка — личная запись: прежняя версия после правки не хранится.
--
-- Ответ заметки цитирует записи «Сохранённых» того же владельца (составной
-- ключ). Цитируемую удалили — строка ответа остаётся с пустой ссылкой и
-- показывается заглушкой.

-- ------------------------------------------------------------------ заметки

alter table public.saved_messages
  drop constraint saved_messages_source_type,
  drop constraint saved_messages_category,
  add constraint saved_messages_source_type check (source_type in ('message', 'comment', 'note')),
  -- Категория заметки своя — для фильтра «мои заметки».
  add constraint saved_messages_category check (source_category in ('channel', 'member', 'visitor', 'note')),
  add column edited_at timestamptz,
  -- Ключ повтора отправки от клиента: повтор с ним не создаёт вторую заметку.
  add column client_id uuid;

alter table public.saved_messages
  add constraint saved_messages_note check (
    (source_type = 'note') = (source_category = 'note')
    and (
      source_type <> 'note' or (
        source_chat_id is null and source_message_id is null and source_comment_id is null
        and source_seq is null and comment_message_id is null and comment_pop_id is null
        and pop_id is null and not author_opaque
        and kind in ('text', 'media', 'voice', 'video_note')
      )
    )
  ),
  add constraint saved_messages_edited check (edited_at is null or source_type = 'note'),
  add constraint saved_messages_client_id check (client_id is null or source_type = 'note');

create unique index saved_messages_owner_client_key on public.saved_messages (owner_id, client_id)
  where client_id is not null;

grant select (edited_at) on public.saved_messages to authenticated;

comment on table public.saved_messages is
  'Сохранённые копии сообщений и комментариев и свои заметки. Видит только владелец; копия не меняется с оригиналом.';

-- Вложение заметки — очищенный файл владельца, того вида, что объявлен
-- типом (как `guard_attachment_object` у сообщений). У копий проверки нет:
-- это снимок вложений оригинала, путь брал не клиент.
create function public.guard_saved_note_object()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kinds text[];
begin
  if not exists (
    select 1 from public.saved_messages s where s.id = new.saved_id and s.source_type = 'note'
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.url is not distinct from old.url
    and new.poster_url is not distinct from old.poster_url
  then
    return new;
  end if;

  kinds := case
    when new.mime_type like 'image/%' then array['photo']
    when new.mime_type like 'video/%' then array['video', 'video_note']
    when new.mime_type like 'audio/%' then array['voice']
    else array[]::text[]
  end;

  if new.pop_id is not null or new.media_hidden
    or not public.media_object_owned('chat-media', new.url, new.owner_id, kinds)
    or (
      new.poster_url is not null
      and not public.media_object_owned('chat-media', new.poster_url, new.owner_id, array['poster'])
    )
  then
    raise exception 'Файл не прошёл проверку перед публикацией' using errcode = 'OPN14';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_saved_note_object() from public, anon, authenticated;

create trigger saved_message_attachments_guard_note
  before insert or update of url, poster_url on public.saved_message_attachments
  for each row execute function public.guard_saved_note_object();

-- Форма заметки — как у сообщения (`check_message_shape`): голосовое и
-- кружок — ровно один файл своего типа без подписи, альбом — хоть один фото
-- или видео, текст — непустой текст без файлов.
create function public.check_saved_note_shape(p_saved uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.saved_messages;
  files int;
  audio int;
  video int;
begin
  select * into s from public.saved_messages where id = p_saved;

  select count(*),
    count(*) filter (where mime_type like 'audio/%'),
    count(*) filter (where mime_type like 'video/%')
  into files, audio, video
  from public.saved_message_attachments where saved_id = p_saved;

  if s.kind = 'text' and (files > 0 or coalesce(btrim(s.text), '') = '') then
    raise exception 'Текстовая заметка — непустой текст без вложений' using errcode = 'check_violation';
  end if;

  if s.kind = 'media' and (files = 0 or audio > 0) then
    raise exception 'В альбоме должен быть хотя бы один файл, без голосовых' using errcode = 'check_violation';
  end if;

  if s.kind = 'voice' and (files <> 1 or audio <> 1 or s.text is not null) then
    raise exception 'У голосовой заметки — ровно одна запись и нет подписи' using errcode = 'check_violation';
  end if;

  if s.kind = 'video_note' and (files <> 1 or video <> 1 or s.text is not null) then
    raise exception 'У кружка — ровно одно видео и нет подписи' using errcode = 'check_violation';
  end if;
end;
$$;

revoke execute on function public.check_saved_note_shape(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------- ответы

create table public.saved_note_replies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  note_id uuid not null,
  position integer not null,
  -- `null` — цитируемую запись удалили: заглушка «Запись удалена».
  quoted_id uuid,
  constraint saved_note_replies_note_fkey foreign key (note_id, owner_id)
    references public.saved_messages (id, owner_id) on delete cascade,
  -- Только своя запись; удаление обнуляет одну ссылку, владелец остаётся.
  constraint saved_note_replies_quoted_fkey foreign key (quoted_id, owner_id)
    references public.saved_messages (id, owner_id) on delete set null (quoted_id),
  constraint saved_note_replies_position check (position >= 0 and position < 100),
  constraint saved_note_replies_not_self check (quoted_id is null or quoted_id <> note_id),
  constraint saved_note_replies_position_key unique (note_id, position)
);

create index saved_note_replies_quoted_idx on public.saved_note_replies (quoted_id)
  where quoted_id is not null;

alter table public.saved_note_replies enable row level security;

create policy saved_note_replies_select_own on public.saved_note_replies
  for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.saved_note_replies from anon, authenticated;
grant select on public.saved_note_replies to authenticated;

comment on table public.saved_note_replies is
  'Цитаты ответа заметки на записи «Сохранённых» того же владельца. Пишет send_saved_note.';

-- --------------------------------------------------------------------- запись

/**
 * Вложения заметки из json-массива: `url`, `poster_url`, `mime_type`,
 * размеры, длительность, волна. Проверку файлов делает триггер.
 */
create function public.saved_note_attach(p_saved uuid, p_owner uuid, p_media jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.saved_message_attachments (
    saved_id, owner_id, position, url, poster_url, mime_type, width, height, duration_ms, waveform
  )
  select p_saved, p_owner, (m.ord - 1)::int,
    m.item ->> 'url',
    nullif(m.item ->> 'poster_url', ''),
    m.item ->> 'mime_type',
    nullif(m.item ->> 'width', '')::int,
    nullif(m.item ->> 'height', '')::int,
    nullif(m.item ->> 'duration_ms', '')::int,
    case when jsonb_typeof(m.item -> 'waveform') = 'array'
      then array(select jsonb_array_elements_text(m.item -> 'waveform')::smallint)
    end
  from jsonb_array_elements(p_media) with ordinality as m(item, ord);
end;
$$;

revoke execute on function public.saved_note_attach(uuid, uuid, jsonb) from public, anon, authenticated;

/**
 * Новая заметка: текст, файлы и цитаты своих записей по порядку. Вид —
 * `voice` или `video_note` (один файл без подписи), иначе по файлам: есть —
 * альбом, нет — текст. Повтор с тем же `p_client_id` отдаёт уже созданную.
 */
create function public.send_saved_note(
  p_client_id uuid,
  p_text text default null,
  p_media jsonb default '[]',
  p_reply_to uuid[] default '{}',
  p_kind text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.saved_caller();
  clean text := nullif(btrim(coalesce(p_text, '')), '');
  media jsonb := coalesce(p_media, '[]'::jsonb);
  quotes uuid[] := coalesce(p_reply_to, '{}');
  note_kind text;
  existing uuid;
  saved uuid;
begin
  if p_client_id is null then
    raise exception 'client id required' using errcode = '22023';
  end if;

  -- Повтор, пока первая отправка ещё в пути, ждёт её и отдаёт её же заметку.
  perform pg_advisory_xact_lock(hashtextextended('saved_note:' || caller::text || p_client_id::text, 0));

  select s.id into existing from public.saved_messages s
  where s.owner_id = caller and s.client_id = p_client_id;

  if existing is not null then
    return existing;
  end if;

  if jsonb_typeof(media) <> 'array' or jsonb_array_length(media) > 50 then
    raise exception 'bad media' using errcode = '22023';
  end if;

  note_kind := case
    when p_kind in ('voice', 'video_note') then p_kind
    when p_kind is null or p_kind in ('text', 'media') then
      case when jsonb_array_length(media) = 0 then 'text' else 'media' end
  end;

  if note_kind is null then
    raise exception 'bad note kind' using errcode = '22023';
  end if;

  if cardinality(quotes) > 100 then
    raise exception 'too many quoted' using errcode = '22023';
  end if;

  if cardinality(array(select distinct q from unnest(quotes) q where q is not null))
    <> cardinality(quotes)
  then
    raise exception 'quoted repeat' using errcode = '22023';
  end if;

  -- Только свои записи: чужую как будто не существует.
  if cardinality(quotes) > 0 and (
    select count(*) from public.saved_messages s where s.id = any (quotes) and s.owner_id = caller
  ) <> cardinality(quotes) then
    raise exception 'saved message not found' using errcode = 'P0002';
  end if;

  insert into public.saved_messages (
    owner_id, source_type, source_category, kind, text, author_id, original_at, client_id
  ) values (
    caller, 'note', 'note', note_kind,
    case when note_kind in ('voice', 'video_note') then null else clean end,
    caller, now(), p_client_id
  ) returning id into saved;

  perform public.saved_note_attach(saved, caller, media);

  insert into public.saved_note_replies (owner_id, note_id, position, quoted_id)
  select caller, saved, (q.ord - 1)::int, q.id
  from unnest(quotes) with ordinality as q(id, ord);

  perform public.check_saved_note_shape(saved);

  return saved;
end;
$$;

revoke execute on function public.send_saved_note(uuid, text, jsonb, uuid[], text) from public, anon;
grant execute on function public.send_saved_note(uuid, text, jsonb, uuid[], text) to authenticated;

/**
 * Правка своей заметки: новый текст и какие вложения оставить — по порядку.
 * Новых файлов правка не добавляет; `p_keep = null` — оставить все. Альбом без файлов, но с текстом,
 * становится текстом. Чужая или несуществующая — `P0002`, копия сообщения —
 * `42501`: копия не меняется.
 */
create function public.edit_saved_note(p_saved uuid, p_text text, p_keep uuid[] default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.saved_caller();
  s public.saved_messages;
  clean text := nullif(btrim(coalesce(p_text, '')), '');
  keep uuid[];
  left_files int;
begin
  perform public.saved_owned(caller, array[p_saved]);

  -- Не сказано, что оставить, — остаётся всё, как было.
  keep := coalesce(p_keep, array(
    select a.id from public.saved_message_attachments a where a.saved_id = p_saved order by a.position
  ));

  select * into s from public.saved_messages where id = p_saved for update;

  if s.source_type <> 'note' then
    raise exception 'saved copies are not editable' using errcode = '42501';
  end if;

  if exists (
    select 1 from unnest(keep) k
    where not exists (select 1 from public.saved_message_attachments a where a.id = k and a.saved_id = p_saved)
  ) then
    raise exception 'attachment not found' using errcode = 'P0002';
  end if;

  delete from public.saved_message_attachments
  where saved_id = p_saved and not (id = any (keep));

  -- Оставленные — подряд, в новом порядке. Через сдвиг: уникальная позиция
  -- проверяется построчно.
  update public.saved_message_attachments set position = position + 1000
  where saved_id = p_saved;
  update public.saved_message_attachments a set position = (k.ord - 1)::int
  from unnest(keep) with ordinality as k(id, ord)
  where a.id = k.id;

  select count(*) into left_files from public.saved_message_attachments where saved_id = p_saved;

  update public.saved_messages set
    text = case when kind in ('voice', 'video_note') then null else clean end,
    kind = case when kind = 'media' and left_files = 0 then 'text' else kind end,
    edited_at = now()
  where id = p_saved;

  perform public.check_saved_note_shape(p_saved);
end;
$$;

revoke execute on function public.edit_saved_note(uuid, text, uuid[]) from public, anon;
grant execute on function public.edit_saved_note(uuid, text, uuid[]) to authenticated;

/**
 * «★ Сохранённые» в листе пересылки заметки: копия — новая заметка с тем же
 * текстом и файлами, без цитат, с тегами и «Посмотреть позже» из листа. По
 * порядку.
 */
create function public.copy_saved_notes(
  p_ids uuid[],
  p_tag_ids uuid[] default '{}',
  p_watch_later boolean default false
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.saved_caller();
  ids uuid[] := public.saved_owned(caller, p_ids);
  tags uuid[] := public.saved_tags_checked(caller, p_tag_ids);
  item record;
  saved uuid;
  copies uuid[] := '{}';
begin
  if exists (select 1 from public.saved_messages where id = any (ids) and source_type <> 'note') then
    raise exception 'only notes are copied' using errcode = '22023';
  end if;

  for item in
    select s.* from (
      select distinct on (t.id) t.id, t.ord from unnest(p_ids) with ordinality as t(id, ord)
      order by t.id, t.ord
    ) t
    join public.saved_messages s on s.id = t.id
    order by t.ord
  loop
    insert into public.saved_messages (
      owner_id, source_type, source_category, kind, text, author_id, original_at, watch_later_at
    ) values (
      caller, 'note', 'note', item.kind, item.text, caller, now(),
      case when coalesce(p_watch_later, false) then now() end
    )
    returning id into saved;

    insert into public.saved_message_attachments (
      saved_id, owner_id, position, url, poster_url, mime_type, width, height, duration_ms, waveform
    )
    select saved, caller, a.position, a.url, a.poster_url, a.mime_type, a.width, a.height,
      a.duration_ms, a.waveform
    from public.saved_message_attachments a
    where a.saved_id = item.id;

    insert into public.saved_message_tags (saved_id, tag_id, owner_id)
    select saved, t.id, caller from unnest(tags) as t(id);

    copies := copies || saved;
  end loop;

  return copies;
end;
$$;

revoke execute on function public.copy_saved_notes(uuid[], uuid[], boolean) from public, anon;
grant execute on function public.copy_saved_notes(uuid[], uuid[], boolean) to authenticated;

-- ------------------------------------------------------------------- чтение

-- Строка теперь несёт пометку правки и цитаты ответа: на каждую — id и
-- номер цитируемой (`null` — удалена), её вид, текст, откуда она и первые
-- файлы для превью. Возвращаемый тип меняется — функции пересоздаются.
drop function public.list_saved_messages(bigint, integer, bigint);
drop function public.list_saved_watch_later(boolean, timestamptz, bigint, integer);
drop function public.saved_rows(uuid[]);

create function public.saved_rows(p_ids uuid[])
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
  select
    s.id, s.seq, s.created_at, s.source_type, s.source_category, s.source_chat_id,
    s.source_message_id, s.source_comment_id, s.source_seq, s.comment_message_id, s.comment_pop_id,
    s.kind, s.text,
    case when s.author_opaque then null else p.id end,
    case when s.author_opaque then s.author_name else p.display_name end,
    case when s.author_opaque then null else p.avatar_url end,
    s.author_opaque or coalesce(p.opaque, false),
    s.original_at, s.pop_id, s.watch_later_at, s.watch_done_at, s.pinned_at,
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
    ), '{}'),
    s.edited_at is not null,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'saved_id', q.id, 'seq', q.seq, 'source_type', q.source_type,
        'source_category', q.source_category, 'source_chat_id', q.source_chat_id,
        'author_name', q.author_name, 'kind', q.kind, 'text', q.text,
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'url', a.url, 'poster_url', a.poster_url, 'mime_type', a.mime_type,
            'duration_ms', a.duration_ms, 'position', a.position, 'pop_id', a.pop_id
          ) order by a.position)
          from public.saved_message_attachments a
          where a.saved_id = q.id and not a.media_hidden
        ), '[]'::jsonb)
      ) order by r.position)
      from public.saved_note_replies r
      left join public.saved_messages q on q.id = r.quoted_id
      where r.note_id = s.id
    ), '[]'::jsonb)
  from public.saved_messages s
  left join lateral (
    select c.* from public.person_card(s.author_id, auth.uid(), s.source_chat_id) c
    where s.author_id is not null
  ) p on true
  where s.owner_id = auth.uid() and s.id = any (p_ids)
$$;

revoke execute on function public.saved_rows(uuid[]) from public, anon, authenticated;

create function public.list_saved_messages(
  p_before_seq bigint default null,
  p_limit integer default 30,
  p_after_seq bigint default null
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
  picked as (
    (
      select s.id from public.saved_messages s
      where s.owner_id = auth.uid() and p_after_seq is null
        and (p_before_seq is null or s.seq < p_before_seq)
      order by s.seq desc
      limit (select n from lim)
    )
    union all
    (
      select s.id from public.saved_messages s
      where s.owner_id = auth.uid() and p_after_seq is not null and s.seq > p_after_seq
      order by s.seq asc
      limit (select n from lim)
    )
  )
  select r.* from public.saved_rows(array(select id from picked)) r
  order by r.seq desc
$$;

revoke execute on function public.list_saved_messages(bigint, integer, bigint) from public, anon;
grant execute on function public.list_saved_messages(bigint, integer, bigint) to authenticated;

create function public.list_saved_watch_later(
  p_after_done boolean default null,
  p_after_at timestamptz default null,
  p_after_seq bigint default null,
  p_limit integer default 30
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
  picked as (
    (
      select s.id, false as done, s.watch_later_at as at, s.seq
      from public.saved_messages s
      where s.owner_id = auth.uid() and s.watch_later_at is not null and s.watch_done_at is null
        and (p_after_done is null
          or (not p_after_done and (s.watch_later_at, s.seq) < (p_after_at, p_after_seq)))
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

revoke execute on function public.list_saved_watch_later(boolean, timestamptz, bigint, integer) from public, anon;
grant execute on function public.list_saved_watch_later(boolean, timestamptz, bigint, integer) to authenticated;
