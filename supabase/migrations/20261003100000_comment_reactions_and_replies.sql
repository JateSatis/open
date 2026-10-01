-- Реакции и ответы в комментариях.
--
-- В комментариях можно всё то же, что с сообщениями, кроме закрепа и
-- пересылки: реакции, ответ, правка и удаление своего. Права те же: реакцию
-- и комментарий оставляет любой аутентифицированный в любом чате, править и
-- удалять — только автор.
--
-- Реакции на комментарий живут в той же полиморфной `reactions`
-- (`target_type = 'comment'`), ряд — по участию в чате комментария, как у
-- сообщений: его ставит база, не клиент. Счётчики — денормализованно в
-- строке комментария, изменение — сигналом в топик комментариев сообщения.
--
-- Ответ на комментарий — ссылки на комментарии той же ветки (того же
-- сообщения), как `message_replies`: составной внешний ключ держит это в
-- схеме, позиция — порядок и лимит.

-- =============================================================================
-- Счётчики реакций на комментарии
-- =============================================================================

alter table public.comments
  add column member_reactions jsonb not null default '{}'::jsonb,
  add column visitor_reactions jsonb not null default '{}'::jsonb,
  add column reactions_count int not null default 0;

-- =============================================================================
-- Цель реакции: сообщение или комментарий
-- =============================================================================

/** Чат, удалённость и вид цели реакции. Для комментария вид — `comment`. */
create function public.reaction_target(kind text, target uuid)
returns table (chat_id uuid, deleted_at timestamptz, target_kind text, message_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  -- Позиционно: имя параметра `kind` совпало бы с колонкой `messages.kind`.
  select m.chat_id, m.deleted_at, m.kind, m.id
  from public.messages m
  where $1 = 'message' and m.id = $2
  union all
  select c.chat_id, c.deleted_at, 'comment', c.message_id
  from public.comments c
  where $1 = 'comment' and c.id = $2
$$;

revoke execute on function public.reaction_target(text, uuid) from public, anon, authenticated;

-- Та же функция, что в 20261002100000_forward_islands.sql, плюс комментарии.
create or replace function public.prepare_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
  revived boolean;
begin
  if tg_op = 'UPDATE' then
    if new.target_type is distinct from old.target_type or new.target_id is distinct from old.target_id then
      raise exception 'reaction target cannot change' using errcode = '42501';
    end if;

    revived := old.deleted_at is not null and new.deleted_at is null;

    if new.emoji is not distinct from old.emoji and not revived then
      new.audience := old.audience;
      new.chat_id := old.chat_id;
      return new;
    end if;
  else
    new.deleted_at := null;
    new.created_at := now();
  end if;

  select * into target from public.reaction_target(new.target_type, new.target_id);

  if target.chat_id is null or target.deleted_at is not null then
    raise exception '% not found', new.target_type using errcode = 'P0002';
  end if;

  if target.target_kind = 'forward' then
    raise exception 'forwards take no reactions: react to the originals' using errcode = '22023';
  end if;

  -- Ряд — по чату цели: у комментария это чат его сообщения.
  new.chat_id := target.chat_id;
  new.updated_at := now();
  new.audience := case
    when exists (
      select 1 from public.chat_members
      where chat_id = target.chat_id and user_id = new.user_id
    ) then 'member'
    else 'visitor'
  end;

  return new;
end;
$$;

-- Та же функция, что в 20260930100000_reactions.sql, плюс комментарии: их
-- счётчики — в строке комментария, сигнал — в топик комментариев сообщения.
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
    returning message_id into comment_message;
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
    elsif comment_message is not null then
      perform realtime.send(
        jsonb_build_object('message_id', comment_message, 'comment_id', target),
        'comment_reactions_changed',
        'comments:' || comment_message::text,
        true
      );
    end if;
  exception
    when others then null;
  end;

  return null;
end;
$$;

-- Та же функция, что в 20261002100000_forward_islands.sql, плюс комментарии.
create or replace function public.set_reaction(target_type text, target_id uuid, reaction text)
returns table (emoji text, audience text)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  kind text := target_type;
  target uuid := target_id;
  target_kind text;
  current_row public.reactions;
  dormant uuid;
  result public.reactions;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Все реакции на одну цель — по очереди, на строке цели: её же обновляет
  -- счётчик, так что лишнего ожидания это не добавляет.
  if kind = 'message' then
    select m.kind into target_kind from public.messages m
    where m.id = target and m.deleted_at is null
    for no key update;
  elsif kind = 'comment' then
    select 'comment' into target_kind from public.comments c
    where c.id = target and c.deleted_at is null
    for no key update;
  else
    raise exception 'reactions to % are not supported', kind using errcode = '22023';
  end if;

  if not found then
    raise exception '% not found', kind using errcode = 'P0002';
  end if;

  if target_kind = 'forward' then
    raise exception 'forwards take no reactions: react to the originals' using errcode = '22023';
  end if;

  select * into current_row
  from public.reactions r
  where r.target_type = kind and r.target_id = target and r.user_id = caller
    and r.deleted_at is null;

  if reaction is null then
    if current_row.id is not null then
      update public.reactions r set deleted_at = now() where r.id = current_row.id;
    end if;

    return;
  end if;

  if current_row.id is not null then
    if current_row.emoji = reaction then
      return query select current_row.emoji, current_row.audience;
      return;
    end if;

    update public.reactions r
    set emoji = reaction
    where r.id = current_row.id
    returning * into result;
  else
    select r.id into dormant
    from public.reactions r
    where r.target_type = kind and r.target_id = target and r.user_id = caller
    order by r.updated_at desc
    limit 1;

    if dormant is not null then
      update public.reactions r
      set emoji = reaction, deleted_at = null
      where r.id = dormant
      returning * into result;
    else
      insert into public.reactions (target_type, target_id, user_id, emoji)
      values (kind, target, caller, reaction)
      returning * into result;
    end if;
  end if;

  return query select result.emoji, result.audience;
end;
$$;

/**
 * Моя реакция на комментарий — той же выборкой, что страница комментариев:
 * `comments?select=…,my_reaction(emoji,audience)`, как у сообщений.
 */
create function public.my_reaction(public.comments)
returns setof public.reactions
language sql
stable
rows 1
set search_path = public
as $$
  select *
  from public.reactions r
  where r.target_type = 'comment'
    and r.target_id = $1.id
    and r.user_id = auth.uid()
    and r.deleted_at is null
$$;

revoke execute on function public.my_reaction(public.comments) from public, anon;
grant execute on function public.my_reaction(public.comments) to authenticated;

-- =============================================================================
-- Ответы на комментарии
-- =============================================================================

-- Пара (id, message_id) — цель составного внешнего ключа цитаты: цитата
-- только из той же ветки.
alter table public.comments
  add constraint comments_id_message_key unique (id, message_id);

create table public.comment_replies (
  id uuid primary key default gen_random_uuid (),
  message_id uuid not null,
  comment_id uuid not null,
  quoted_id uuid not null,
  position int not null check (position >= 0 and position < 100),
  created_at timestamptz not null default now(),
  constraint comment_replies_comment_fkey
    foreign key (comment_id, message_id) references public.comments (id, message_id) on delete cascade,
  constraint comment_replies_quoted_fkey
    foreign key (quoted_id, message_id) references public.comments (id, message_id) on delete cascade,
  constraint comment_replies_not_self check (quoted_id <> comment_id),
  constraint comment_replies_position_key unique (comment_id, position),
  constraint comment_replies_quoted_key unique (comment_id, quoted_id)
);

create index comment_replies_quoted_id_idx on public.comment_replies (quoted_id);

alter table public.comment_replies enable row level security;

-- Какие комментарии процитированы — не секрет; содержимое цитаты читается
-- из `comments` под её политикой, удалённое не отдаётся.
create policy "comment_replies are readable by authenticated users"
  on public.comment_replies for select
  to authenticated
  using (true);

-- Цитаты прикрепляются только к своему комментарию и только в транзакции его
-- отправки (время комментария — `now()` лишь в ней), и только живые
-- комментарии той же ветки. Участие в чате не проверяется: отвечать на
-- комментарии может любой, как и комментировать.
create policy "comment_replies are attached by the author when sending"
  on public.comment_replies for insert
  to authenticated
  with check (
    exists (
      select 1 from public.comments c
      where c.id = comment_replies.comment_id
        and c.message_id = comment_replies.message_id
        and c.author_id = auth.uid()
        and c.created_at = now()
    )
    and exists (
      select 1 from public.comments q
      where q.id = comment_replies.quoted_id
        and q.message_id = comment_replies.message_id
    )
  );

revoke update, delete on public.comment_replies from anon, authenticated;
revoke insert on public.comment_replies from anon;

/** Цитаты нового комментария — по порядку. Security invoker: под политикой выше. */
create function public.add_comment_replies(new_comment uuid, target_message uuid, reply_to uuid[])
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
    where id = any (reply_to) and message_id = target_message
  ) <> wanted then
    raise exception 'quoted comment not found' using errcode = 'P0002';
  end if;

  insert into public.comment_replies (message_id, comment_id, quoted_id, position)
  select target_message, new_comment, quoted.id, (quoted.ord - 1)::int
  from unnest(reply_to) with ordinality as quoted(id, ord);
end;
$$;

revoke execute on function public.add_comment_replies(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.add_comment_replies(uuid, uuid, uuid[]) to authenticated;

-- =============================================================================
-- Отправка с ответом
-- =============================================================================
--
-- Те же функции, что в 20260930180000_comments.sql, плюс `reply_to`. Старые
-- сигнатуры удаляются: две перегрузки с одним набором именованных
-- аргументов PostgREST не различит.

drop function public.send_comment(uuid, text, jsonb);
drop function public.send_voice_comment(uuid, jsonb);

create function public.send_comment(
  target_message uuid,
  comment_text text,
  media jsonb default '[]'::jsonb,
  reply_to uuid[] default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_chat uuid;
  new_id uuid;
  new_kind text;
  item jsonb;
  item_index int := 0;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if media is null then
    media := '[]'::jsonb;
  end if;

  if jsonb_typeof(media) <> 'array' then
    raise exception 'media должен быть json-массивом' using errcode = '22023';
  end if;

  if jsonb_array_length(media) > 50 then
    raise exception 'Нельзя отправить больше 50 файлов за раз' using errcode = 'check_violation';
  end if;

  select chat_id into target_chat from public.messages where id = target_message;

  if target_chat is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  new_kind := case when jsonb_array_length(media) = 0 then 'text' else 'media' end;

  insert into public.comments (chat_id, message_id, author_id, kind, text)
  values (
    target_chat,
    target_message,
    auth.uid(),
    new_kind,
    nullif(btrim(coalesce(comment_text, '')), '')
  )
  returning id into new_id;

  for item in select value from jsonb_array_elements(media)
  loop
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

    item_index := item_index + 1;
  end loop;

  perform public.add_comment_replies(new_id, target_message, reply_to);

  return new_id;
end;
$$;

revoke execute on function public.send_comment(uuid, text, jsonb, uuid[]) from public, anon;
grant execute on function public.send_comment(uuid, text, jsonb, uuid[]) to authenticated;

create function public.send_voice_comment(
  target_message uuid,
  voice jsonb,
  reply_to uuid[] default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_chat uuid;
  new_id uuid;
  bars smallint[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if voice is null or jsonb_typeof(voice) <> 'object' then
    raise exception 'voice должен быть json-объектом' using errcode = '22023';
  end if;

  select chat_id into target_chat from public.messages where id = target_message;

  if target_chat is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if voice -> 'waveform' is not null and jsonb_typeof(voice -> 'waveform') = 'array' then
    select array_agg(value::smallint order by ord)
    into bars
    from jsonb_array_elements_text(voice -> 'waveform') with ordinality as t(value, ord);
  end if;

  insert into public.comments (chat_id, message_id, author_id, kind)
  values (target_chat, target_message, auth.uid(), 'voice')
  returning id into new_id;

  insert into public.comment_attachments (
    comment_id, comment_kind, url, mime_type, duration_ms, size_bytes, waveform, position
  ) values (
    new_id,
    'voice',
    voice ->> 'url',
    voice ->> 'mime_type',
    nullif(voice ->> 'duration_ms', '')::int,
    nullif(voice ->> 'size_bytes', '')::bigint,
    bars,
    0
  );

  perform public.add_comment_replies(new_id, target_message, reply_to);

  return new_id;
end;
$$;

revoke execute on function public.send_voice_comment(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.send_voice_comment(uuid, jsonb, uuid[]) to authenticated;
