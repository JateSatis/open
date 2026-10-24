-- Сохранённые сообщения, этап 2: всё, что человек меняет в «Сохранённых», —
-- теги записи, «Посмотреть позже», закрепы, удаление, — только функциями
-- владельца. Чужой id — отказ тем же кодом, что и несуществующий (`P0002`):
-- чужого сохранённого как будто нет.
--
-- Страницы: «Все» листаются в обе стороны от любой записи (переход к
-- закрепу, которого нет среди загруженного, грузит окно вокруг него, а не
-- всю историю), «Посмотреть позже» — своим порядком с составным курсором.

-- ------------------------------------------------------------------ закрепы

alter table public.saved_messages add column pinned_at timestamptz;

create index saved_messages_pinned_idx on public.saved_messages (owner_id, pinned_at)
  where pinned_at is not null;

grant select (pinned_at) on public.saved_messages to authenticated;

-- Порядок «Посмотреть позже»: активные новыми вперёд, затем выполненные —
-- последнее отмеченное первым. Курсор — (время, seq) внутри каждой части.
drop index public.saved_messages_watch_idx;
create index saved_messages_watch_active_idx on public.saved_messages (owner_id, watch_later_at, seq)
  where watch_later_at is not null and watch_done_at is null;
create index saved_messages_watch_done_idx on public.saved_messages (owner_id, watch_done_at, seq)
  where watch_done_at is not null;

alter table public.saved_messages add constraint saved_messages_watch_order check (
  watch_done_at is null or watch_done_at >= watch_later_at
);

-- ------------------------------------------------------------------ проверки

-- Все id — свои записи, без дублей; иначе — отказ, как несуществующее.
create function public.saved_owned(p_owner uuid, p_ids uuid[])
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
  from unnest(coalesce(p_ids, '{}')) as t(id)
  where t.id is not null;

  if cardinality(ids) = 0 then
    raise exception 'nothing selected' using errcode = '22023';
  end if;

  if cardinality(ids) > 500 then
    raise exception 'too many saved messages in one call' using errcode = '22023';
  end if;

  if (
    select count(*) from public.saved_messages s where s.id = any (ids) and s.owner_id = p_owner
  ) <> cardinality(ids) then
    raise exception 'saved message not found' using errcode = 'P0002';
  end if;

  return ids;
end;
$$;

revoke execute on function public.saved_owned(uuid, uuid[]) from public, anon, authenticated;

create function public.saved_caller()
returns uuid
language plpgsql
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  return auth.uid();
end;
$$;

revoke execute on function public.saved_caller() from public, anon, authenticated;

-- ---------------------------------------------------------------------- теги

-- Поставить или снять тег у записи. Счётчик `uses_count` ведёт триггер связи.
create function public.set_saved_tag(p_saved uuid, p_tag uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.saved_caller();
begin
  perform public.saved_owned(caller, array[p_saved]);

  if not exists (select 1 from public.saved_tags t where t.id = p_tag and t.owner_id = caller) then
    raise exception 'tag not found' using errcode = 'P0002';
  end if;

  if coalesce(p_on, false) then
    insert into public.saved_message_tags (saved_id, tag_id, owner_id)
    values (p_saved, p_tag, caller)
    on conflict do nothing;
  else
    delete from public.saved_message_tags where saved_id = p_saved and tag_id = p_tag;
  end if;
end;
$$;

revoke execute on function public.set_saved_tag(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_saved_tag(uuid, uuid, boolean) to authenticated;

-- ------------------------------------------------------- «Посмотреть позже»

-- `later` — в список дел (уже там — без изменений), `done` / `undone` —
-- отметить выполненным или снять отметку (только тем, что в списке), `off` —
-- убрать из вкладки: запись остаётся в «Все».
create function public.set_saved_watch_later(p_ids uuid[], p_state text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.saved_caller();
  ids uuid[] := public.saved_owned(caller, p_ids);
begin
  case p_state
    when 'later' then
      update public.saved_messages set watch_later_at = now()
      where id = any (ids) and watch_later_at is null;
    when 'done' then
      update public.saved_messages set watch_done_at = now()
      where id = any (ids) and watch_later_at is not null and watch_done_at is null;
    when 'undone' then
      update public.saved_messages set watch_done_at = null where id = any (ids);
    when 'off' then
      update public.saved_messages set watch_later_at = null, watch_done_at = null
      where id = any (ids);
    else
      raise exception 'bad watch later state' using errcode = '22023';
  end case;
end;
$$;

revoke execute on function public.set_saved_watch_later(uuid[], text) from public, anon;
grant execute on function public.set_saved_watch_later(uuid[], text) to authenticated;

-- «Вернуть» после свайпа: прежние время добавления и отметка. Это личные
-- данные владельца, поэтому значения — от клиента, но правдоподобные: не из
-- будущего и отметка не раньше добавления.
create function public.restore_saved_watch_later(
  p_saved uuid,
  p_later_at timestamptz,
  p_done_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.saved_caller();
begin
  perform public.saved_owned(caller, array[p_saved]);

  if p_later_at is null or p_later_at > now()
    or (p_done_at is not null and (p_done_at < p_later_at or p_done_at > now())) then
    raise exception 'bad watch later time' using errcode = '22023';
  end if;

  update public.saved_messages set watch_later_at = p_later_at, watch_done_at = p_done_at
  where id = p_saved;
end;
$$;

revoke execute on function public.restore_saved_watch_later(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.restore_saved_watch_later(uuid, timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------------------ закрепы

-- Закрепов несколько, порядок — по времени закрепления. Повторный закреп
-- уже закреплённой записи время не трогает.
create function public.set_saved_pinned(p_ids uuid[], p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.saved_caller();
  ids uuid[] := public.saved_owned(caller, p_ids);
begin
  if coalesce(p_pinned, false) then
    update public.saved_messages set pinned_at = clock_timestamp()
    where id = any (ids) and pinned_at is null;
  else
    update public.saved_messages set pinned_at = null where id = any (ids);
  end if;
end;
$$;

revoke execute on function public.set_saved_pinned(uuid[], boolean) from public, anon;
grant execute on function public.set_saved_pinned(uuid[], boolean) to authenticated;

-- ------------------------------------------------------------------ удаление

-- Физически: это личная закладка. Вложения и связи с тегами уходят каскадом
-- (счётчики тегов уменьшает триггер связи), отметка и закреп — вместе со
-- строкой. Файлы в Storage не трогаются: это файлы оригинала.
create function public.delete_saved_messages(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.saved_caller();
  ids uuid[] := public.saved_owned(caller, p_ids);
  n integer;
begin
  delete from public.saved_messages where id = any (ids) and owner_id = caller;
  get diagnostics n = row_count;

  return n;
end;
$$;

revoke execute on function public.delete_saved_messages(uuid[]) from public, anon;
grant execute on function public.delete_saved_messages(uuid[]) to authenticated;

-- ------------------------------------------------------------------- чтение

-- Строки сохранённого по id — одна раскладка для всех страниц. Автор —
-- глазами владельца сейчас (`person_card` в чате оригинала); подменённый при
-- сохранении — снимком имени. Вложения и теги — той же строкой. Только свои.
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
    ), '{}')
  from public.saved_messages s
  left join lateral (
    select c.* from public.person_card(s.author_id, auth.uid(), s.source_chat_id) c
    where s.author_id is not null
  ) p on true
  where s.owner_id = auth.uid() and s.id = any (p_ids)
$$;

revoke execute on function public.saved_rows(uuid[]) from public, anon, authenticated;


-- Страница «Все», новыми вперёд. `p_before_seq` — к более старым,
-- `p_after_seq` — к более новым (ближайшие к курсору), оба нет — самые новые.
-- Окно вокруг записи — два вызова: до неё включительно и после.
drop function public.list_saved_messages(bigint, integer);

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
  tag_ids uuid[]
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

-- Страница «Посмотреть позже»: активные по `watch_later_at desc`, затем
-- выполненные по `watch_done_at desc`, при равном времени — по `seq desc`.
-- Курсор — последняя строка прошлой страницы: выполнена ли, её время в своей
-- части и `seq`. Нет курсора — с начала.
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
  tag_ids uuid[]
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

-- Закрепы для полосы под переключателем — по времени закрепления, от
-- первого к последнему. Их мало, поэтому одним списком.
create function public.list_saved_pins()
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
  order by s.pinned_at, s.seq
  limit 200
$$;

revoke execute on function public.list_saved_pins() from public, anon;
grant execute on function public.list_saved_pins() to authenticated;

-- Что из выбранного можно переслать: живой оригинал, видимый мне сейчас.
-- Копия в чат не уходит никогда — пересылается оригинал, островком из чата
-- источника или ссылкой на комментарий. Удалённое, скрытое блокировкой,
-- из удалённого или недоступного чата — `live = false`.
create function public.saved_forwardable(p_ids uuid[])
returns table (
  saved_id uuid,
  live boolean,
  chat_id uuid,
  message_id uuid,
  comment_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := public.saved_caller();
  ids uuid[] := public.saved_owned(caller, p_ids);
begin
  return query
  select s.id,
    x.ok,
    case when x.ok then s.source_chat_id end,
    case when x.ok and s.source_type = 'message' then s.source_message_id end,
    case when x.ok and s.source_type = 'comment' then s.source_comment_id end
  from public.saved_messages s
  cross join lateral (
    select s.source_chat_id is not null and public.chat_readable(s.source_chat_id) and (
      case when s.source_type = 'message' then exists (
        select 1 from public.message_rows r
        where r.id = s.source_message_id and not r.hidden and r.kind not in ('system', 'forward')
      )
      else exists (
        select 1 from public.comment_rows r
        where r.id = s.source_comment_id and r.deleted_at is null
      )
      end
    ) as ok
  ) x
  where s.id = any (ids)
  order by s.seq;
end;
$$;

revoke execute on function public.saved_forwardable(uuid[]) from public, anon;
grant execute on function public.saved_forwardable(uuid[]) to authenticated;
