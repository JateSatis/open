-- Каналы, этап 3в: закреп комментария и пересылка комментариев к попу.
--
-- Закреп. У цели комментариев — сообщения или попа — не больше одного живого
-- закреплённого комментария, и только верхнего уровня. Закрепляет автор
-- контента:
--   * у попа и у поста канала (сообщение чата `channel_posts`) — тот, кто
--     может публиковать в канале (`can_publish_in_channel`);
--   * у сообщения личного диалога или группы — автор сообщения.
-- Новый закреп мягко снимает прежний; удаление комментария снимает его закреп.
-- Отдельная таблица, а не колонка: `messages` — горячая таблица без прямой
-- правки, а у попа и сообщения закреп устроен одинаково — по ключу цели.
--
-- Закреплённый комментарий отдаётся отдельно (`pinned_comment`), а страницы
-- ранга (`list_comment_thread_roots`) его не содержат — в списке нет дубля.
--
-- Пересылка: комментарий к попу пересылается так же, как к сообщению, —
-- снимается запрет в `forward_comments`. Превью (`message_preview_text`) цель
-- комментария не читает, ему поп безразличен.

-- =============================================================================
-- Таблица
-- =============================================================================

create table public.comment_pins (
  id uuid primary key default gen_random_uuid (),
  target_id uuid not null,
  comment_id uuid not null,
  pinned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Закреп не пересекает границу цели: комментарий — той же цели.
  foreign key (comment_id, target_id) references public.comments (id, target_id) on delete cascade
);

create unique index comment_pins_active_target_key
  on public.comment_pins (target_id)
  where deleted_at is null;

create index comment_pins_comment_id_idx
  on public.comment_pins (comment_id)
  where deleted_at is null;

alter table public.comment_pins enable row level security;

-- Закреп — часть публичной ветки: видит и посетитель.
create policy "comment_pins are readable by authenticated users"
  on public.comment_pins for select
  to authenticated
  using (deleted_at is null);

-- Прямой записи нет: закреп и открепление — только функциями ниже.
revoke insert, update, delete on public.comment_pins from anon, authenticated;

-- =============================================================================
-- Право
-- =============================================================================

/**
 * Может ли `who` закреплять комментарии цели. `null` — цели нет или она
 * удалена. Одно место для правила: функции закрепа и открепления.
 */
create function public.comment_pin_right(target uuid, who uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m public.messages;
  p public.pops;
  chat_kind text;
  channel uuid;
begin
  select * into p from public.pops where id = target;

  if p.id is not null then
    if p.deleted_at is not null then
      return null;
    end if;

    return public.can_publish_in_channel(p.channel_id, who);
  end if;

  select * into m from public.messages where id = target;

  if m.id is null or m.deleted_at is not null then
    return null;
  end if;

  select kind into chat_kind from public.chats where id = m.chat_id;

  if chat_kind = 'channel_posts' then
    select id into channel from public.channels where posts_chat_id = m.chat_id;

    return channel is not null and public.can_publish_in_channel(channel, who);
  end if;

  return m.author_id is not distinct from who and who is not null;
end;
$$;

revoke execute on function public.comment_pin_right(uuid, uuid) from public, anon, authenticated;

-- =============================================================================
-- Закреп и открепление
-- =============================================================================

/**
 * Закрепляет верхнеуровневый комментарий у его цели. Прежний закреп той же
 * цели снимается в этой же транзакции. Повтор не ошибка.
 */
create function public.pin_comment(target_comment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.comments;
  allowed boolean;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- for share: удаление того же комментария ждёт, пока закреп не ляжет, и
  -- затем снимает его своим триггером.
  select * into c from public.comments where id = target_comment for share;

  if c.id is null or c.deleted_at is not null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  if c.thread_root_id is not null then
    raise exception 'only top-level comments can be pinned' using errcode = '22023';
  end if;

  allowed := public.comment_pin_right(c.target_id, caller);

  if allowed is null then
    raise exception 'comment target not found' using errcode = 'P0002';
  end if;

  if not allowed then
    raise exception 'only the author of the content can pin comments' using errcode = '42501';
  end if;

  -- Два закрепа одной цели разом — по очереди: иначе второй упрётся в
  -- уникальный индекс, не увидев снятия первого.
  perform pg_advisory_xact_lock(hashtextextended('comment_pins:' || c.target_id::text, 0));

  if exists (
    select 1 from public.comment_pins
    where target_id = c.target_id and comment_id = c.id and deleted_at is null
  ) then
    return;
  end if;

  update public.comment_pins
  set deleted_at = now()
  where target_id = c.target_id and deleted_at is null;

  insert into public.comment_pins (target_id, comment_id, pinned_by)
  values (c.target_id, c.id, caller);
end;
$$;

revoke execute on function public.pin_comment(uuid) from public, anon;
grant execute on function public.pin_comment(uuid) to authenticated;

/** Снимает закреп у цели — сообщения или попа. Нет закрепа — не ошибка. */
create function public.unpin_comment(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  allowed boolean;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  allowed := public.comment_pin_right(target, caller);

  if allowed is null then
    raise exception 'comment target not found' using errcode = 'P0002';
  end if;

  if not allowed then
    raise exception 'only the author of the content can unpin comments' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('comment_pins:' || target::text, 0));

  update public.comment_pins
  set deleted_at = now()
  where target_id = target and deleted_at is null;
end;
$$;

revoke execute on function public.unpin_comment(uuid) from public, anon;
grant execute on function public.unpin_comment(uuid) to authenticated;

-- =============================================================================
-- Удаление снимает закреп
-- =============================================================================

create function public.unpin_deleted_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comment_pins
  set deleted_at = now()
  where comment_id = new.id and deleted_at is null;

  return null;
end;
$$;

revoke execute on function public.unpin_deleted_comment() from public, anon, authenticated;

create trigger on_comment_deleted_unpin
  after update of deleted_at on public.comments
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.unpin_deleted_comment();

-- =============================================================================
-- Сигнал
-- =============================================================================

-- В топик ветки цели: открытые панели перечитывают закреп. Payload — сигнал.
create function public.broadcast_comment_pin_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('target_id', new.target_id, 'comment_id', new.comment_id),
      'comment_pin_changed',
      'comments:' || new.target_id::text,
      true
    );
  exception
    when others then null;
  end;

  return null;
end;
$$;

revoke execute on function public.broadcast_comment_pin_changed() from public, anon, authenticated;

create trigger on_comment_pins_changed
  after insert or update on public.comment_pins
  for each row execute function public.broadcast_comment_pin_changed();

-- =============================================================================
-- Чтение
-- =============================================================================

/**
 * Закреплённый комментарий цели — ноль или одна строка, те же колонки, что у
 * страницы верха. Security invoker: удалённое прячет RLS.
 */
create function public.pinned_comment(target uuid)
returns setof public.comments
language sql
stable
security invoker
set search_path = public
as $$
  select c.*
  from public.comment_pins p
  join public.comments c on c.id = p.comment_id
  where p.target_id = target and p.deleted_at is null and c.deleted_at is null
$$;

revoke execute on function public.pinned_comment(uuid) from public, anon;
grant execute on function public.pinned_comment(uuid) to authenticated;

-- Та же функция, что в 20261011100000_pop_comments.sql, без закреплённого:
-- он идёт отдельно и первым, в ранге не повторяется.
create or replace function public.list_comment_thread_roots(
  target uuid,
  after_rank double precision default null,
  after_id uuid default null,
  page_size int default 30
)
returns setof public.comments
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.comments;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  for c in
    select *
    from public.comments
    where target_id = target
      and thread_root_id is null
      and (deleted_at is null or replies_count > 0)
      and (after_rank is null or (rank, id) < (after_rank, after_id))
      and not exists (
        select 1 from public.comment_pins p
        where p.comment_id = comments.id and p.deleted_at is null
      )
    order by rank desc, id desc
    limit least(greatest(coalesce(page_size, 30), 1), 100)
  loop
    if c.deleted_at is not null then
      c.author_id := null;
      c.text := null;
      c.edited_at := null;
      c.member_reactions := '{}'::jsonb;
      c.visitor_reactions := '{}'::jsonb;
      c.reactions_count := 0;
    end if;

    return next c;
  end loop;
end;
$$;

-- =============================================================================
-- Пересылка комментариев к попу
-- =============================================================================

-- Та же функция, что в 20261011100000_pop_comments.sql, без отказа
-- комментариям к попу.
create or replace function public.forward_comments(target_chat uuid, comment_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  ids uuid[];
  wanted int;
  found int;
  item record;
  new_id uuid;
  new_ids uuid[] := '{}';
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.chat_members cm
    join public.chats c on c.id = cm.chat_id
    where cm.chat_id = target_chat and cm.user_id = caller and c.deleted_at is null
  ) then
    raise exception 'only chat members can forward comments here' using errcode = '42501';
  end if;

  select array_agg(u.id order by u.ord) into ids
  from (
    select distinct on (t.id) t.id, t.ord
    from unnest(comment_ids) with ordinality as t(id, ord)
    where t.id is not null
    order by t.id, t.ord
  ) u;

  wanted := coalesce(cardinality(ids), 0);

  if wanted = 0 then
    raise exception 'nothing to forward' using errcode = '22023';
  end if;

  if wanted > 100 then
    raise exception 'too many comments in one call' using errcode = '22023';
  end if;

  perform 1 from public.comments
  where id = any (ids) and deleted_at is null
  for share;

  select count(*) into found
  from public.comments
  where id = any (ids) and deleted_at is null;

  if found <> wanted then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  for item in
    select t.id, t.ord from unnest(ids) with ordinality as t(id, ord) order by t.ord
  loop
    insert into public.messages (chat_id, author_id, kind, forwarded_comment_id, created_at)
    values (
      target_chat,
      caller,
      'comment_forward',
      item.id,
      now() + (item.ord - 1) * interval '1 microsecond'
    )
    returning id into new_id;

    new_ids := new_ids || new_id;
  end loop;

  return new_ids;
end;
$$;
