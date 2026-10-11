-- Каналы, этап 3а: реакции и просмотры попа.
--
-- У попа свои реакции и просмотры, отдельные от поста, который его
-- показывает. Реакции — в той же полиморфной `reactions`
-- (`target_type = 'pop'`), один общий ряд, как у комментария: счётчики —
-- одним `reactions` в строке попа. Просмотры — по образцу сообщений
-- (`message_views`): пара «поп + зритель», счётчики в строке попа.
--
-- `reactions.chat_id` у реакции на поп — чат постов канала. Колонка значит
-- «где живёт цель», и у попа это канал, а его чат постов — та же сущность;
-- реакция уходит вместе с чатом по тому же каскаду, что и остальные. Ряд
-- (`audience`) у попа в показе не участвует, но база всё равно ставит его —
-- по праву публиковать в канале: пригодится для метки «Автор» в
-- комментариях попа.
--
-- Изменения счётчиков — сигналом в топик канала `pops:<channel_id>`:
-- топики чатов слушают экраны переписки, а поп живёт вне переписки.

-- =============================================================================
-- Право публиковать — для любого человека, не только вызывающего
-- =============================================================================
--
-- Ряд реакции ставит триггер по владельцу строки, а не по `auth.uid()`.
-- Предикат по-прежнему один: версия без человека — обёртка.

create function public.can_publish_in_channel(target_channel uuid, publisher uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.channels ch
    join public.chat_members cm on cm.chat_id = ch.posts_chat_id
    where ch.id = target_channel
      and ch.deleted_at is null
      and cm.user_id = publisher
  )
$$;

revoke execute on function public.can_publish_in_channel(uuid, uuid) from public, anon, authenticated;

create or replace function public.can_publish_in_channel(target_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_publish_in_channel(target_channel, auth.uid())
$$;

-- =============================================================================
-- Счётчики на попе
-- =============================================================================
--
-- Пишут только триггер реакций и `record_pop_views`: прямого UPDATE у
-- клиента на `pops` нет с миграции попсов.

alter table public.pops
  add column reactions jsonb not null default '{}'::jsonb,
  add column reactions_count int not null default 0,
  add column views_count int not null default 0,
  add column unique_views_count int not null default 0;

-- =============================================================================
-- Цель реакции: сообщение, комментарий или поп
-- =============================================================================

alter table public.reactions drop constraint reactions_target_type_check;
alter table public.reactions
  add constraint reactions_target_type_check check (target_type in ('message', 'comment', 'pop'));

-- Та же функция, что в 20261003100000_comment_reactions_and_replies.sql, плюс
-- поп и канал цели: чат попа — чат постов его канала. Удалённый канал
-- считается удалённой целью.
drop function public.reaction_target(text, uuid);

create function public.reaction_target(kind text, target uuid)
returns table (
  chat_id uuid,
  deleted_at timestamptz,
  target_kind text,
  message_id uuid,
  channel_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  -- Позиционно: имя параметра `kind` совпало бы с колонкой `messages.kind`.
  select m.chat_id, m.deleted_at, m.kind, m.id, null::uuid
  from public.messages m
  where $1 = 'message' and m.id = $2
  union all
  select c.chat_id, c.deleted_at, 'comment', c.message_id, null::uuid
  from public.comments c
  where $1 = 'comment' and c.id = $2
  union all
  select ch.posts_chat_id, coalesce(p.deleted_at, ch.deleted_at), 'pop', null::uuid, p.channel_id
  from public.pops p
  join public.channels ch on ch.id = p.channel_id
  where $1 = 'pop' and p.id = $2
$$;

revoke execute on function public.reaction_target(text, uuid) from public, anon, authenticated;

-- Та же функция, что в 20261007120000_reaction_limits_and_reactors.sql, плюс
-- поп: ряд — по праву публиковать в канале, лимит — по общему ряду, как у
-- комментария (20 разных, `reaction_kinds_limit`).
create or replace function public.prepare_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
  revived boolean;
  member_counts jsonb;
  visitor_counts jsonb;
  counts jsonb;
  taken int;
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

  if target.target_kind = 'comment_forward' then
    raise exception 'forwarded comments take no reactions: react to the comment' using errcode = '22023';
  end if;

  new.chat_id := target.chat_id;
  new.updated_at := now();

  if new.target_type = 'pop' then
    new.audience := case
      when public.can_publish_in_channel(target.channel_id, new.user_id) then 'member'
      else 'visitor'
    end;
  else
    new.audience := case
      when exists (
        select 1 from public.chat_members
        where chat_id = target.chat_id and user_id = new.user_id
      ) then 'member'
      else 'visitor'
    end;
  end if;

  if new.target_type = 'message' then
    select m.member_reactions, m.visitor_reactions into member_counts, visitor_counts
    from public.messages m
    where m.id = new.target_id
    for no key update;

    counts := case when new.audience = 'member' then member_counts else visitor_counts end;
  elsif new.target_type = 'comment' then
    select c.member_reactions, c.visitor_reactions into member_counts, visitor_counts
    from public.comments c
    where c.id = new.target_id
    for no key update;

    counts := public.reaction_counts_merge(member_counts, visitor_counts);
  else
    select p.reactions into counts
    from public.pops p
    where p.id = new.target_id
    for no key update;
  end if;

  if not counts ? new.emoji then
    select count(*) into taken from jsonb_object_keys(counts);

    -- Смена моей реакции: если я был единственным у прежней, её место
    -- освобождается тем же движением. У комментария и попа ряд общий.
    if tg_op = 'UPDATE' and old.deleted_at is null and old.emoji <> new.emoji
       and (new.target_type <> 'message' or old.audience = new.audience)
       and (counts ->> old.emoji)::int = 1 then
      taken := taken - 1;
    end if;

    if taken >= public.reaction_kinds_limit(new.target_type, new.audience) then
      raise exception 'reaction kinds limit reached'
        using errcode = 'OR001', hint = 'reaction_limit';
    end if;
  end if;

  return new;
end;
$$;

-- Та же функция, что в 20261003100000_comment_reactions_and_replies.sql, плюс
-- поп: один общий ряд в строке попа, сигнал — в топик канала.
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
    returning message_id into comment_message;
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
    elsif kind = 'comment' and comment_message is not null then
      perform realtime.send(
        jsonb_build_object('message_id', comment_message, 'comment_id', target),
        'comment_reactions_changed',
        'comments:' || comment_message::text,
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

-- Та же функция, что в 20261004110000_comment_forwards.sql, плюс поп. Живость
-- и вид цели — из `reaction_target`; блокировка — на строке цели, её же
-- обновляет счётчик.
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
  found_target record;
  current_row public.reactions;
  dormant uuid;
  result public.reactions;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if kind is null or kind not in ('message', 'comment', 'pop') then
    raise exception 'reactions to % are not supported', kind using errcode = '22023';
  end if;

  -- Все реакции на одну цель — по очереди, на строке цели.
  if kind = 'message' then
    perform 1 from public.messages m where m.id = target for no key update;
  elsif kind = 'comment' then
    perform 1 from public.comments c where c.id = target for no key update;
  else
    perform 1 from public.pops p where p.id = target for no key update;
  end if;

  select * into found_target from public.reaction_target(kind, target);

  if found_target.chat_id is null or found_target.deleted_at is not null then
    raise exception '% not found', kind using errcode = 'P0002';
  end if;

  if found_target.target_kind = 'forward' then
    raise exception 'forwards take no reactions: react to the originals' using errcode = '22023';
  end if;

  if found_target.target_kind = 'comment_forward' then
    raise exception 'forwarded comments take no reactions: react to the comment' using errcode = '22023';
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
 * Моя реакция на поп — той же выборкой, что страница попсов:
 * `pops?select=…,my_reaction(emoji)`, как у сообщений и комментариев.
 */
create function public.my_reaction(public.pops)
returns setof public.reactions
language sql
stable
rows 1
set search_path = public
as $$
  select *
  from public.reactions r
  where r.target_type = 'pop'
    and r.target_id = $1.id
    and r.user_id = auth.uid()
    and r.deleted_at is null
$$;

revoke execute on function public.my_reaction(public.pops) from public, anon;
grant execute on function public.my_reaction(public.pops) to authenticated;

-- =============================================================================
-- Просмотры попа
-- =============================================================================
--
-- Поп засчитывает просмотр, как только стал активной страницей просмотра.
-- Каждый показ — +1 к `views_count`, первый показ человеком — ещё и +1 к
-- `unique_views_count`. Сервер клиенту не верит: повторный показ одной пары
-- засчитывается не чаще раза в 10 секунд, так что накрутка одним аккаунтом
-- в обход приложения упирается в 6 просмотров в минуту на поп. Сессию клиент
-- называет для истории, правило от неё не зависит: туда-сюда по ленте
-- попсов — честные повторные показы в одной сессии.
--
-- Что человек смотрел — его личная история: политик нет, таблица закрыта
-- целиком, пишет только функция ниже.

create table public.pop_views (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pop_id uuid not null references public.pops (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  -- Сессия экрана, в которой засчитан последний показ.
  session_id uuid not null,
  counted_at timestamptz not null default now(),
  constraint pop_views_pop_viewer_key unique (pop_id, viewer_id)
);

create index pop_views_viewer_id_idx on public.pop_views (viewer_id);

alter table public.pop_views enable row level security;

revoke all on public.pop_views from anon, authenticated;

/**
 * Засчитывает показы попсов пачкой. Удалённые попсы и попсы удалённых
 * каналов пропускаются; показы тех, кто может публиковать в канале попа, не
 * считаются. После записи — сигнал `pop_views_changed` в топик каждого
 * затронутого канала.
 */
create function public.record_pop_views(pop_ids uuid[], session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  valid uuid[];
  channels_touched jsonb;
  touched record;
begin
  if viewer is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if session_id is null then
    raise exception 'session is required' using errcode = '22004';
  end if;

  if coalesce(cardinality(pop_ids), 0) = 0 then
    return;
  end if;

  if cardinality(pop_ids) > 200 then
    raise exception 'too many pops' using errcode = '22023';
  end if;

  select coalesce(array_agg(p.id), '{}')
  into valid
  from public.pops p
  join public.channels ch on ch.id = p.channel_id
  where p.id = any (pop_ids)
    and p.deleted_at is null
    and ch.deleted_at is null
    and not public.can_publish_in_channel(p.channel_id, viewer);

  if cardinality(valid) = 0 then
    return;
  end if;

  with upserted as (
      insert into public.pop_views as v (pop_id, viewer_id, session_id, counted_at)
      select id, viewer, record_pop_views.session_id, now()
      from unnest(valid) as id
      on conflict (pop_id, viewer_id) do update
        set session_id = excluded.session_id,
            counted_at = excluded.counted_at
        where v.counted_at <= now() - interval '10 seconds'
      -- xmax = 0 — строку вставили, а не обновили: первый показ человеком.
      returning v.pop_id, (v.xmax = 0) as first_view
    ),
    bumped as (
      update public.pops p
      set views_count = p.views_count + 1,
          unique_views_count = p.unique_views_count + case when u.first_view then 1 else 0 end
      from upserted u
      where p.id = u.pop_id
      returning p.id, p.channel_id
    )
  select coalesce(jsonb_agg(jsonb_build_object('channel_id', channel_id, 'ids', ids)), '[]')
  into channels_touched
  from (select channel_id, array_agg(id) as ids from bumped group by channel_id) per_channel;

  -- Изменяющий CTE не может быть запросом цикла, поэтому каналы — заранее.
  for touched in
    select (t ->> 'channel_id')::uuid as channel_id, t -> 'ids' as ids
    from jsonb_array_elements(channels_touched) t
  loop
    begin
      perform realtime.send(
        jsonb_build_object('channel_id', touched.channel_id, 'pop_ids', touched.ids),
        'pop_views_changed',
        'pops:' || touched.channel_id::text,
        true
      );
    exception
      when others then null;
    end;
  end loop;
end;
$$;

revoke execute on function public.record_pop_views(uuid[], uuid) from public, anon;
grant execute on function public.record_pop_views(uuid[], uuid) to authenticated;

-- =============================================================================
-- Топик попсов канала
-- =============================================================================
--
-- Читают все: попсы публичны. Писать в топик клиенту нечего — сигналы кладут
-- триггер реакций и `record_pop_views`.

create policy "pop topics are readable by authenticated users"
  on realtime.messages for select
  to authenticated
  using (realtime.topic() like 'pops:%');
