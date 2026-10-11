-- Каналы, этап 3б: комментарии к попу.
--
-- Комментарий принадлежит либо сообщению, либо попу — ровно одному. Всё, что
-- есть у комментариев к сообщениям (треды, цитаты, вложения, голосовые,
-- реакции, ранг, правка, удаление, ревизии), работает и у попа. Комментарии к
-- попу отдельны от комментариев к посту, который этот поп показывает.
--
-- Общий ключ цели — вычисляемая `target_id = coalesce(message_id, pop_id)`.
-- На неё переходят все составные ключи, что держались за `message_id`: ветка
-- (`thread_root_id`) и цитаты (`comment_replies`) не пересекают границу цели
-- ни у сообщений, ни у попсов, — это держит схема, а не функция. Id сообщений
-- и попсов — случайные uuid, общего пространства им хватает.
--
-- `chat_id` комментария к попу — чат постов канала: так не нужны новые ветки в
-- реакциях на комментарии (`reaction_target`), а ряд реакции по участию в чате
-- постов и есть «может публиковать в канале». Чат ставит триггер, не клиент.
--
-- Ряд комментария к попу — `member`, если автор может публиковать в канале
-- (`can_publish_in_channel`), иначе `visitor`. В интерфейсе это метка «Автор».
--
-- Комментарии к сообщениям ведут себя ровно как раньше: старые сигнатуры
-- `send_comment`, `send_voice_comment`, `list_thread_roots` остаются, события
-- и счётчики — те же.

-- =============================================================================
-- Счётчик на попе
-- =============================================================================

alter table public.pops
  add column comments_count int not null default 0;

-- =============================================================================
-- Цель комментария
-- =============================================================================

alter table public.comments
  add column pop_id uuid references public.pops (id) on delete cascade,
  alter column message_id drop not null,
  add constraint comments_one_target check (num_nonnulls(message_id, pop_id) = 1),
  add column target_id uuid generated always as (coalesce(message_id, pop_id)) stored;

alter table public.comments
  add constraint comments_id_target_key unique (id, target_id);

-- Ветка — внутри одной цели.
alter table public.comments
  drop constraint comments_thread_root_fkey,
  add constraint comments_thread_root_fkey
    foreign key (thread_root_id, target_id) references public.comments (id, target_id) on delete cascade;

-- Цитаты — внутри одной цели. Колонка цитаты называется по ключу, на который
-- ссылается; имена внешних ключей прежние — по ним клиент встраивает цитаты.
alter table public.comment_replies
  drop constraint comment_replies_comment_fkey,
  drop constraint comment_replies_quoted_fkey;

alter table public.comment_replies rename column message_id to target_id;

alter table public.comment_replies
  add constraint comment_replies_comment_fkey
    foreign key (comment_id, target_id) references public.comments (id, target_id) on delete cascade,
  add constraint comment_replies_quoted_fkey
    foreign key (quoted_id, target_id) references public.comments (id, target_id) on delete cascade;

alter table public.comments drop constraint comments_id_message_key;

drop policy "comment_replies are attached by the author when sending" on public.comment_replies;

create policy "comment_replies are attached by the author when sending"
  on public.comment_replies for insert
  to authenticated
  with check (
    exists (
      select 1 from public.comments c
      where c.id = comment_replies.comment_id
        and c.target_id = comment_replies.target_id
        and c.author_id = auth.uid()
        and c.created_at = now()
    )
    and exists (
      select 1 from public.comments q
      where q.id = comment_replies.quoted_id
        and q.target_id = comment_replies.target_id
    )
  );

-- Ранг и дочитывание по сигналу — по цели.
drop index public.comments_thread_roots_rank_idx;
create index comments_thread_roots_rank_idx
  on public.comments (target_id, rank desc, id desc)
  where thread_root_id is null;

drop index public.comments_message_id_created_at_idx;
create index comments_target_id_created_at_idx
  on public.comments (target_id, created_at desc)
  where deleted_at is null;

create index comments_pop_id_idx on public.comments (pop_id) where pop_id is not null;

grant insert (pop_id) on public.comments to authenticated;

-- Ревизии помнят цель так же.
alter table public.comment_revisions
  add column pop_id uuid references public.pops (id) on delete cascade,
  alter column message_id drop not null,
  add constraint comment_revisions_one_target check (num_nonnulls(message_id, pop_id) = 1);

-- =============================================================================
-- Подготовка комментария
-- =============================================================================

-- Та же функция, что в 20261004110000_comment_forwards.sql, плюс поп: живой
-- поп живого канала, чат — чат постов канала, ряд — по праву публиковать.
create or replace function public.prepare_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.messages;
  target_pop public.pops;
  pop_chat uuid;
  root_parent uuid;
begin
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  new.replies_count := 0;

  if new.pop_id is not null then
    -- for key share — как у сообщения: счётчик комментариев обновляет строку
    -- попа без ключевых колонок и с блокировкой не конфликтует.
    select * into target_pop
    from public.pops
    where id = new.pop_id
    for key share;

    select posts_chat_id into pop_chat
    from public.channels
    where id = target_pop.channel_id and deleted_at is null;

    if target_pop.id is null or target_pop.deleted_at is not null or pop_chat is null then
      raise exception 'pop not found' using errcode = 'P0002';
    end if;

    new.chat_id := pop_chat;
  else
    select * into target
    from public.messages
    where id = new.message_id
    for key share;

    if target.id is null or target.deleted_at is not null then
      raise exception 'message not found' using errcode = 'P0002';
    end if;

    if target.kind = 'system' then
      raise exception 'system messages cannot be commented' using errcode = '22023';
    end if;

    if target.kind = 'forward' then
      raise exception 'forwards take no comments: comment on the originals' using errcode = '22023';
    end if;

    if target.kind = 'comment_forward' then
      raise exception 'forwarded comments take no comments' using errcode = '22023';
    end if;
  end if;

  -- Удалённый корень тред не закрывает. Чужую цель у корня отвергнет
  -- составной внешний ключ.
  if new.thread_root_id is not null then
    select thread_root_id into root_parent from public.comments where id = new.thread_root_id;

    if root_parent is not null then
      raise exception 'replies go into the thread of a top-level comment' using errcode = '22023';
    end if;
  end if;

  if new.pop_id is not null then
    new.audience := case
      when public.can_publish_in_channel(target_pop.channel_id, new.author_id) then 'member'
      else 'visitor'
    end;
  else
    new.audience := case
      when exists (
        select 1 from public.chat_members
        where chat_id = target.chat_id and user_id = new.author_id
      ) then 'member'
      else 'visitor'
    end;
  end if;

  return new;
end;
$$;

-- =============================================================================
-- Счётчики и события
-- =============================================================================

-- Та же функция, что в 20261004100000_comment_threads.sql, плюс поп: счётчик —
-- `pops.comments_count`, сигнал счётчика — в топик канала `pops:<channel_id>`.
-- События ветки — в топик цели `comments:<target_id>`, как раньше.
create or replace function public.handle_comment_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  delta int := 0;
  event text;
  target uuid := coalesce(new.message_id, new.pop_id);
  pop_channel uuid;
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then
      delta := 1;
      event := 'comment_added';
    end if;
  elsif old.deleted_at is null and new.deleted_at is not null then
    delta := -1;
    event := 'comment_deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    delta := 1;
    event := 'comment_added';
  elsif new.deleted_at is null and new.edited_at is distinct from old.edited_at then
    event := 'comment_edited';
  end if;

  if event is null then
    return null;
  end if;

  if delta <> 0 then
    if new.pop_id is not null then
      update public.pops
      set comments_count = greatest(0, comments_count + delta)
      where id = new.pop_id
      returning channel_id into pop_channel;
    else
      update public.messages
      set comments_count = greatest(0, comments_count + delta)
      where id = new.message_id;
    end if;

    if new.thread_root_id is not null then
      update public.comments
      set replies_count = greatest(0, replies_count + delta)
      where id = new.thread_root_id;
    end if;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object(
        'message_id', new.message_id,
        'pop_id', new.pop_id,
        'comment_id', new.id,
        'thread_root_id', new.thread_root_id
      ),
      event,
      'comments:' || target::text,
      true
    );

    if delta <> 0 and new.pop_id is not null then
      perform realtime.send(
        jsonb_build_object('channel_id', pop_channel, 'pop_id', new.pop_id),
        'pop_comments_changed',
        'pops:' || pop_channel::text,
        true
      );
    elsif delta <> 0 then
      perform realtime.send(
        jsonb_build_object('chat_id', new.chat_id, 'message_id', new.message_id),
        'comments_changed',
        'chat:' || new.chat_id::text,
        true
      );
    end if;
  exception
    when others then null;
  end;

  return null;
end;
$$;

/**
 * Поп, к которому открыта панель, удаляют — панель показывает «Поп удалён».
 * Как `broadcast_comment_target_changed` у сообщений: сигнал в топик
 * комментариев попа.
 */
create function public.broadcast_pop_comment_target_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('pop_id', new.id),
      'target_changed',
      'comments:' || new.id::text,
      true
    );
  exception
    when others then null;
  end;

  return null;
end;
$$;

revoke execute on function public.broadcast_pop_comment_target_changed() from public, anon, authenticated;

create trigger on_pop_changed_for_comments
  after update of deleted_at on public.pops
  for each row
  when (old.deleted_at is distinct from new.deleted_at)
  execute function public.broadcast_pop_comment_target_changed();

-- Та же функция, что в 20261010100000_pop_reactions_and_views.sql; у
-- комментария сигнал — в топик его цели, сообщения или попа.
create or replace function public.count_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_active boolean := tg_op <> 'INSERT' and old.deleted_at is null;
  is_active boolean := tg_op <> 'DELETE' and new.deleted_at is null;
  kind text := coalesce(new.target_type, old.target_type);
  target uuid := coalesce(new.target_id, old.target_id);
  target_chat uuid := coalesce(new.chat_id, old.chat_id);
  comment_message uuid;
  comment_pop uuid;
  pop_channel uuid;
  old_member text;
  old_visitor text;
  new_member text;
  new_visitor text;
begin
  if was_active and is_active
     and old.emoji = new.emoji and old.audience = new.audience then
    return null;
  end if;

  if was_active then
    old_member := case when old.audience = 'member' then old.emoji end;
    old_visitor := case when old.audience = 'visitor' then old.emoji end;
  end if;

  if is_active then
    new_member := case when new.audience = 'member' then new.emoji end;
    new_visitor := case when new.audience = 'visitor' then new.emoji end;
  end if;

  if kind = 'message' then
    update public.messages
    set
      member_reactions = public.reaction_counts_add(
        public.reaction_counts_add(member_reactions, old_member, -1), new_member, 1
      ),
      visitor_reactions = public.reaction_counts_add(
        public.reaction_counts_add(visitor_reactions, old_visitor, -1), new_visitor, 1
      ),
      reactions_count = greatest(0, reactions_count - was_active::int + is_active::int)
    where id = target;
  elsif kind = 'comment' then
    update public.comments
    set
      member_reactions = public.reaction_counts_add(
        public.reaction_counts_add(member_reactions, old_member, -1), new_member, 1
      ),
      visitor_reactions = public.reaction_counts_add(
        public.reaction_counts_add(visitor_reactions, old_visitor, -1), new_visitor, 1
      ),
      reactions_count = greatest(0, reactions_count - was_active::int + is_active::int)
    where id = target
    returning message_id, pop_id into comment_message, comment_pop;
  elsif kind = 'pop' then
    if was_active and is_active and old.emoji = new.emoji then
      return null;
    end if;

    update public.pops
    set
      reactions = public.reaction_counts_add(
        public.reaction_counts_add(
          reactions, case when was_active then old.emoji end, -1
        ),
        case when is_active then new.emoji end,
        1
      ),
      reactions_count = greatest(0, reactions_count - was_active::int + is_active::int)
    where id = target
    returning channel_id into pop_channel;
  else
    return null;
  end if;

  -- Payload — сигнал: счётчики клиент перечитывает из базы, пачкой.
  begin
    if kind = 'message' then
      perform realtime.send(
        jsonb_build_object('chat_id', target_chat, 'message_id', target),
        'reactions_changed',
        'chat:' || target_chat::text,
        true
      );
    elsif kind = 'comment' and coalesce(comment_message, comment_pop) is not null then
      perform realtime.send(
        jsonb_build_object('message_id', comment_message, 'pop_id', comment_pop, 'comment_id', target),
        'comment_reactions_changed',
        'comments:' || coalesce(comment_message, comment_pop)::text,
        true
      );
    elsif kind = 'pop' and pop_channel is not null then
      perform realtime.send(
        jsonb_build_object('channel_id', pop_channel, 'pop_id', target),
        'pop_reactions_changed',
        'pops:' || pop_channel::text,
        true
      );
    end if;
  exception
    when others then null;
  end;

  return null;
end;
$$;

-- =============================================================================
-- Треды и цитаты по цели
-- =============================================================================
--
-- Те же функции, что в 20261004100000_comment_threads.sql,
-- 20261003100000_comment_reactions_and_replies.sql и
-- 20261005120000_comment_thread_explicit.sql, но по ключу цели. Первый
-- аргумент — id цели: сообщения или попа. Имя прежнее, чтобы не менять
-- сигнатуры.

create or replace function public.comment_thread_of(target_message uuid, reply_to uuid[])
returns uuid
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  wanted int := coalesce(cardinality(array(select distinct unnest(reply_to))), 0);
  found int;
  roots uuid[];
begin
  if wanted = 0 then
    return null;
  end if;

  select count(*), array_agg(distinct coalesce(thread_root_id, id))
  into found, roots
  from public.comments
  where id = any (reply_to) and target_id = target_message;

  if found <> wanted then
    raise exception 'quoted comment not found' using errcode = 'P0002';
  end if;

  if cardinality(roots) <> 1 then
    raise exception 'quotes must come from one thread' using errcode = '22023';
  end if;

  return roots[1];
end;
$$;

create or replace function public.is_comment_thread_root(target_message uuid, root uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.comments
    where id = root and target_id = target_message and thread_root_id is null
  );
$$;

create or replace function public.add_comment_replies(new_comment uuid, target_message uuid, reply_to uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  wanted int;
begin
  wanted := coalesce(cardinality(reply_to), 0);

  if wanted = 0 then
    return;
  end if;

  if wanted > 100 then
    raise exception 'too many quoted comments' using errcode = '22023';
  end if;

  if cardinality(array(select distinct unnest(reply_to))) <> wanted then
    raise exception 'quoted comments repeat' using errcode = '22023';
  end if;

  if (
    select count(*) from public.comments
    where id = any (reply_to) and target_id = target_message
  ) <> wanted then
    raise exception 'quoted comment not found' using errcode = 'P0002';
  end if;

  insert into public.comment_replies (target_id, comment_id, quoted_id, position)
  select target_message, new_comment, quoted.id, (quoted.ord - 1)::int
  from unnest(reply_to) with ordinality as quoted(id, ord);
end;
$$;

-- =============================================================================
-- Отправка
-- =============================================================================

/**
 * Общая отправка комментария к сообщению или к попу — ровно к одному.
 * Текст или альбом (`media`), либо голосовое (`voice`). Вызывают обёртки
 * ниже; security invoker — вставка идёт под политиками от своего имени, так
 * что прямой вызов ничего сверх них не даёт.
 */
create function public.post_comment(
  target_message uuid,
  target_pop uuid,
  comment_text text,
  media jsonb,
  voice jsonb,
  reply_to uuid[],
  thread_root uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target uuid := coalesce(target_message, target_pop);
  target_chat uuid;
  root uuid;
  new_id uuid;
  new_kind text;
  items jsonb;
  item jsonb;
  item_index int := 0;
  bars smallint[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if num_nonnulls(target_message, target_pop) <> 1 then
    raise exception 'comment goes to one message or one pop' using errcode = '22023';
  end if;

  if voice is not null then
    if jsonb_typeof(voice) <> 'object' then
      raise exception 'voice должен быть json-объектом' using errcode = '22023';
    end if;

    new_kind := 'voice';
    items := jsonb_build_array(voice);
  else
    if media is null then
      media := '[]'::jsonb;
    end if;

    if jsonb_typeof(media) <> 'array' then
      raise exception 'media должен быть json-массивом' using errcode = '22023';
    end if;

    if jsonb_array_length(media) > 50 then
      raise exception 'Нельзя отправить больше 50 файлов за раз' using errcode = 'check_violation';
    end if;

    new_kind := case when jsonb_array_length(media) = 0 then 'text' else 'media' end;
    items := media;
  end if;

  -- Удалённые сообщение и поп SELECT-политики не отдают.
  if target_message is not null then
    select chat_id into target_chat from public.messages where id = target_message;

    if target_chat is null then
      raise exception 'message not found' using errcode = 'P0002';
    end if;
  else
    select ch.posts_chat_id into target_chat
    from public.pops p
    join public.channels ch on ch.id = p.channel_id
    where p.id = target_pop;

    if target_chat is null then
      raise exception 'pop not found' using errcode = 'P0002';
    end if;
  end if;

  root := public.resolve_comment_thread(target, reply_to, thread_root);

  insert into public.comments (chat_id, message_id, pop_id, author_id, kind, text, thread_root_id)
  values (
    target_chat,
    target_message,
    target_pop,
    auth.uid(),
    new_kind,
    case when new_kind = 'voice' then null else nullif(btrim(coalesce(comment_text, '')), '') end,
    root
  )
  returning id into new_id;

  for item in select value from jsonb_array_elements(items)
  loop
    bars := null;

    if new_kind = 'voice' then
      if item -> 'waveform' is not null and jsonb_typeof(item -> 'waveform') = 'array' then
        select array_agg(value::smallint order by ord)
        into bars
        from jsonb_array_elements_text(item -> 'waveform') with ordinality as t(value, ord);
      end if;

      insert into public.comment_attachments (
        comment_id, comment_kind, url, mime_type, duration_ms, size_bytes, waveform, position
      ) values (
        new_id,
        'voice',
        item ->> 'url',
        item ->> 'mime_type',
        nullif(item ->> 'duration_ms', '')::int,
        nullif(item ->> 'size_bytes', '')::bigint,
        bars,
        0
      );
    else
      insert into public.comment_attachments (
        comment_id, comment_kind, url, poster_url, mime_type, width, height, duration_ms,
        size_bytes, position
      ) values (
        new_id,
        new_kind,
        item ->> 'url',
        nullif(item ->> 'poster_url', ''),
        item ->> 'mime_type',
        nullif(item ->> 'width', '')::int,
        nullif(item ->> 'height', '')::int,
        nullif(item ->> 'duration_ms', '')::int,
        nullif(item ->> 'size_bytes', '')::bigint,
        item_index
      );
    end if;

    item_index := item_index + 1;
  end loop;

  perform public.add_comment_replies(new_id, target, reply_to);

  return new_id;
end;
$$;

revoke execute on function public.post_comment(uuid, uuid, text, jsonb, jsonb, uuid[], uuid) from public, anon;
grant execute on function public.post_comment(uuid, uuid, text, jsonb, jsonb, uuid[], uuid) to authenticated;

-- Те же сигнатуры, что в 20261005120000_comment_thread_explicit.sql.
create or replace function public.send_comment(
  target_message uuid,
  comment_text text,
  media jsonb default '[]'::jsonb,
  reply_to uuid[] default null,
  thread_root uuid default null
)
returns uuid
language sql
security invoker
set search_path = public
as $$
  select public.post_comment(target_message, null, comment_text, media, null, reply_to, thread_root)
$$;

create or replace function public.send_voice_comment(
  target_message uuid,
  voice jsonb,
  reply_to uuid[] default null,
  thread_root uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
begin
  if voice is null then
    raise exception 'voice должен быть json-объектом' using errcode = '22023';
  end if;

  return public.post_comment(target_message, null, null, null, voice, reply_to, thread_root);
end;
$$;

/** Текст или альбом с подписью к попу. */
create function public.send_pop_comment(
  target_pop uuid,
  comment_text text,
  media jsonb default '[]'::jsonb,
  reply_to uuid[] default null,
  thread_root uuid default null
)
returns uuid
language sql
security invoker
set search_path = public
as $$
  select public.post_comment(null, target_pop, comment_text, media, null, reply_to, thread_root)
$$;

revoke execute on function public.send_pop_comment(uuid, text, jsonb, uuid[], uuid) from public, anon;
grant execute on function public.send_pop_comment(uuid, text, jsonb, uuid[], uuid) to authenticated;

/** Голосовое к попу. */
create function public.send_voice_pop_comment(
  target_pop uuid,
  voice jsonb,
  reply_to uuid[] default null,
  thread_root uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
begin
  if voice is null then
    raise exception 'voice должен быть json-объектом' using errcode = '22023';
  end if;

  return public.post_comment(null, target_pop, null, null, voice, reply_to, thread_root);
end;
$$;

revoke execute on function public.send_voice_pop_comment(uuid, jsonb, uuid[], uuid) from public, anon;
grant execute on function public.send_voice_pop_comment(uuid, jsonb, uuid[], uuid) to authenticated;

-- =============================================================================
-- Выборка верха
-- =============================================================================

/**
 * Страница верхнеуровневых комментариев цели — сообщения или попа — по рангу.
 * Тело — из `list_thread_roots` (20261004100000_comment_threads.sql), но по
 * ключу цели; `list_thread_roots` теперь обёртка над ней.
 */
create function public.list_comment_thread_roots(
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

revoke execute on function public.list_comment_thread_roots(uuid, double precision, uuid, int) from public, anon;
grant execute on function public.list_comment_thread_roots(uuid, double precision, uuid, int) to authenticated;

create or replace function public.list_thread_roots(
  target_message uuid,
  after_rank double precision default null,
  after_id uuid default null,
  page_size int default 30
)
returns setof public.comments
language sql
stable
security invoker
set search_path = public
as $$
  select * from public.list_comment_thread_roots(target_message, after_rank, after_id, page_size)
  where message_id = target_message
$$;

-- =============================================================================
-- Правка
-- =============================================================================

-- Та же функция, что в 20260930180000_comments.sql, плюс поп: к удалённому попу
-- комментарии не принимаются и правкой, ревизия помнит поп.
create or replace function public.edit_comment(
  target_comment uuid,
  comment_text text,
  media jsonb default '[]'::jsonb,
  voice jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.comments;
  old_files jsonb;
  new_text text := nullif(btrim(coalesce(comment_text, '')), '');
  new_kind text;
  items jsonb;
  item jsonb;
  item_index int := 0;
  kept uuid;
  kept_row public.comment_attachments;
  bars smallint[];
  new_urls text[] := '{}';
  old_urls text[];
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if media is null then
    media := '[]'::jsonb;
  end if;

  if jsonb_typeof(media) <> 'array' then
    raise exception 'media должен быть json-массивом' using errcode = '22023';
  end if;

  if voice is not null and jsonb_typeof(voice) = 'null' then
    voice := null;
  end if;

  if voice is not null and jsonb_typeof(voice) <> 'object' then
    raise exception 'voice должен быть json-объектом' using errcode = '22023';
  end if;

  select * into c from public.comments where id = target_comment for update;

  if c.id is null or c.deleted_at is not null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  if c.author_id is distinct from caller then
    raise exception 'only own comments can be edited' using errcode = '42501';
  end if;

  if c.pop_id is not null then
    perform 1
    from public.pops p
    join public.channels ch on ch.id = p.channel_id
    where p.id = c.pop_id and p.deleted_at is null and ch.deleted_at is null
    for key share of p;

    if not found then
      raise exception 'pop not found' using errcode = 'P0002';
    end if;
  else
    perform 1 from public.messages
    where id = c.message_id and deleted_at is null
    for key share;

    if not found then
      raise exception 'message not found' using errcode = 'P0002';
    end if;
  end if;

  -- ------------------------------------------------------------ вид итога
  if voice is not null then
    if new_text is not null or jsonb_array_length(media) > 0 then
      raise exception 'Голосовое идёт без подписи и без других вложений'
        using errcode = 'check_violation';
    end if;

    new_kind := 'voice';
    items := jsonb_build_array(voice);
  elsif jsonb_array_length(media) > 0 then
    if jsonb_array_length(media) > 50 then
      raise exception 'В альбоме не больше 50 файлов' using errcode = 'check_violation';
    end if;

    new_kind := 'media';
    items := media;
  elsif new_text is not null then
    new_kind := 'text';
    items := '[]'::jsonb;
  else
    raise exception 'Пустой комментарий сохранить нельзя' using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(items) as i(value)
    where i.value ? 'attachment_id'
      and not exists (
        select 1 from public.comment_attachments a
        where a.comment_id = c.id and a.id::text = i.value ->> 'attachment_id'
      )
  ) then
    raise exception 'attachment not found' using errcode = 'P0002';
  end if;

  if (
    select count(*) <> count(distinct i.value ->> 'attachment_id')
    from jsonb_array_elements(items) as i(value)
    where i.value ? 'attachment_id'
  ) then
    raise exception 'attachments repeat' using errcode = '22023';
  end if;

  -- ------------------------------------------------ ничего не изменилось
  select coalesce(array_agg(url order by position), '{}') into old_urls
  from public.comment_attachments where comment_id = c.id;

  select coalesce(
    array_agg(
      coalesce(
        (select a.url from public.comment_attachments a
         where a.comment_id = c.id and a.id::text = i.value ->> 'attachment_id'),
        i.value ->> 'url'
      )
      order by i.ord
    ),
    '{}'
  )
  into new_urls
  from jsonb_array_elements(items) with ordinality as i(value, ord);

  if new_kind = c.kind and new_text is not distinct from c.text and new_urls = old_urls then
    return;
  end if;

  -- ------------------------------------------------------------- ревизия
  select coalesce(jsonb_agg(to_jsonb(a) order by a.position), '[]'::jsonb) into old_files
  from public.comment_attachments a where a.comment_id = c.id;

  insert into public.comment_revisions (
    comment_id, message_id, pop_id, chat_id, author_id, kind, text, attachments, version_at
  ) values (
    c.id, c.message_id, c.pop_id, c.chat_id, c.author_id, c.kind, c.text, old_files,
    coalesce(c.edited_at, c.created_at)
  );

  -- --------------------------------------------------- замена содержимого
  delete from public.comment_attachments where comment_id = c.id;

  update public.comments
  set kind = new_kind, text = new_text, edited_at = now()
  where id = c.id;

  for item in select value from jsonb_array_elements(items)
  loop
    if item ? 'attachment_id' then
      kept := (item ->> 'attachment_id')::uuid;

      select * into kept_row
      from jsonb_populate_recordset(null::public.comment_attachments, old_files)
      where id = kept;

      insert into public.comment_attachments (
        id, comment_id, comment_kind, url, poster_url, mime_type, width, height, duration_ms,
        size_bytes, waveform, position, created_at
      ) values (
        kept_row.id, c.id, new_kind, kept_row.url, kept_row.poster_url, kept_row.mime_type,
        kept_row.width, kept_row.height, kept_row.duration_ms, kept_row.size_bytes,
        kept_row.waveform, item_index, kept_row.created_at
      );
    else
      bars := null;

      if item -> 'waveform' is not null and jsonb_typeof(item -> 'waveform') = 'array' then
        select array_agg(value::smallint order by ord)
        into bars
        from jsonb_array_elements_text(item -> 'waveform') with ordinality as t(value, ord);
      end if;

      insert into public.comment_attachments (
        comment_id, comment_kind, url, poster_url, mime_type, width, height, duration_ms,
        size_bytes, waveform, position
      ) values (
        c.id,
        new_kind,
        item ->> 'url',
        nullif(item ->> 'poster_url', ''),
        item ->> 'mime_type',
        nullif(item ->> 'width', '')::int,
        nullif(item ->> 'height', '')::int,
        nullif(item ->> 'duration_ms', '')::int,
        nullif(item ->> 'size_bytes', '')::bigint,
        bars,
        item_index
      );
    end if;

    item_index := item_index + 1;
  end loop;

  perform public.check_comment_shape(c.id);
end;
$$;

-- =============================================================================
-- Пересылка
-- =============================================================================

-- Та же функция, что в 20261004110000_comment_forwards.sql, плюс отказ
-- комментариям к попу: их пересылка — отдельный этап.
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

  if exists (select 1 from public.comments where id = any (ids) and pop_id is not null) then
    raise exception 'pop comments cannot be forwarded yet' using errcode = '22023';
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
