-- Выделенные фрагменты, этап 1: фрагмент текста сообщения с реакциями и
-- комментариями.
--
-- Фрагмент — непрерывный кусок текста сообщения, на который человек поставил
-- реакцию или написал комментарий. Пока нет ни того ни другого, фрагмента
-- нет: строка рождается спящей (`deleted_at` задан) в той же транзакции, что
-- первая реакция или первый комментарий (`ensure_fragment`), оживает от них и
-- снова засыпает, когда у неё не остаётся ни живой реакции, ни живого
-- комментария. Спящий не виден никому. Фрагменты разных людей на
-- одном куске — разные строки; у одного человека один живой фрагмент на
-- диапазон.
--
-- Диапазон — полуоткрытый `[start_offset, end_offset)` в code points, как
-- `char_length` и `substr` Postgres для UTF-8. Якорь — `exact_text` плюс
-- соседние `prefix_text` / `suffix_text`: при правке текста фрагмент ищется
-- заново (`rebind_message_fragments`). Не нашёлся или нашёлся неоднозначно —
-- `anchor_state = 'lost'`: на тексте не показывается, комментарии живут.
--
-- Реакции на фрагмент — свой ряд в строке фрагмента, не в `messages`:
-- счётчик реакций сообщения от них не меняется. Комментарии к фрагменту —
-- обычные комментарии сообщения с `fragment_id` (только у корня): они и в
-- общем шите, и в `messages.comments_count`.

-- =============================================================================
-- Фрагмент
-- =============================================================================

/** Столько code points соседнего текста помнит якорь с каждой стороны. */
create function public.fragment_context_length()
returns int
language sql
immutable
as $$
  select 32
$$;

create table public.message_fragments (
  id uuid primary key default gen_random_uuid (),
  message_id uuid not null,
  chat_id uuid not null,
  author_id uuid references public.profiles (id) on delete set null,
  start_offset int not null,
  end_offset int not null,
  exact_text text not null,
  prefix_text text not null default '',
  suffix_text text not null default '',
  /** exact — на месте; shifted — найден заново после правки; lost — не найден. */
  anchor_state text not null default 'exact',
  /** Версия текста, на которой создан: `coalesce(edited_at, created_at)` сообщения. */
  text_version timestamptz not null,
  member_reactions jsonb not null default '{}'::jsonb,
  visitor_reactions jsonb not null default '{}'::jsonb,
  reactions_count int not null default 0,
  comments_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint message_fragments_range check (start_offset >= 0 and end_offset > start_offset),
  constraint message_fragments_exact_length
    check (char_length(exact_text) = end_offset - start_offset),
  constraint message_fragments_anchor_state check (anchor_state in ('exact', 'shifted', 'lost')),
  constraint message_fragments_message_fkey
    foreign key (message_id, chat_id) references public.messages (id, chat_id) on delete cascade,
  constraint message_fragments_id_message_key unique (id, message_id)
);

comment on table public.message_fragments is
  'Фрагменты текста сообщений с реакциями и комментариями. Пишут только функции.';

-- Один живой фрагмент на автора и диапазон. Потерянный диапазона не держит:
-- его смещения — от прежнего текста.
create unique index message_fragments_author_range_key
  on public.message_fragments (message_id, author_id, start_offset, end_offset)
  where deleted_at is null and anchor_state <> 'lost';

create index message_fragments_message_id_idx
  on public.message_fragments (message_id)
  where deleted_at is null;

create index message_fragments_author_id_idx on public.message_fragments (author_id);

alter table public.message_fragments enable row level security;

create policy "message_fragments are readable by authenticated users"
  on public.message_fragments for select
  to authenticated
  using (deleted_at is null);

-- Пишут только функции: прямых INSERT / UPDATE / DELETE у клиента нет.
revoke insert, update, delete on public.message_fragments from anon, authenticated;

/** Живых видимых фрагментов у сообщения — для свечения облачка (этап 3). */
alter table public.messages
  add column fragments_count int not null default 0;

-- =============================================================================
-- Жизнь фрагмента и счётчик у сообщения
-- =============================================================================

/**
 * Фрагмент живёт, пока у него есть живая реакция или живой комментарий:
 * счётчики дошли до нуля — `deleted_at`, ожили — снова живой. Новая строка
 * рождается спящей и оживает от первой реакции или комментария: фрагмент,
 * созданный и брошенный (прямым вызовом мимо приложения), не виден.
 */
create function public.prepare_fragment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.deleted_at := now();
    new.reactions_count := 0;
    new.comments_count := 0;
    new.member_reactions := '{}'::jsonb;
    new.visitor_reactions := '{}'::jsonb;
  elsif tg_op = 'UPDATE'
     and (new.reactions_count, new.comments_count) is distinct from (old.reactions_count, old.comments_count) then
    new.deleted_at := case
      when new.reactions_count = 0 and new.comments_count = 0 then coalesce(old.deleted_at, now())
      else null
    end;
  end if;

  return new;
end;
$$;

revoke execute on function public.prepare_fragment() from public, anon, authenticated;

create trigger on_fragment_written
  before insert or update on public.message_fragments
  for each row execute function public.prepare_fragment();

/**
 * Видимый фрагмент — живой и не потерянный. Их число — в строке сообщения,
 * появление и исчезновение — сигналом в топик чата.
 */
create function public.count_fragment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_shown boolean := tg_op = 'UPDATE' and old.deleted_at is null and old.anchor_state <> 'lost';
  is_shown boolean := new.deleted_at is null and new.anchor_state <> 'lost';
begin
  if was_shown = is_shown then
    return null;
  end if;

  update public.messages
  set fragments_count = greatest(0, fragments_count + case when is_shown then 1 else -1 end)
  where id = new.message_id;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', new.chat_id, 'message_id', new.message_id),
      'fragments_changed',
      'chat:' || new.chat_id::text,
      true
    );
  exception
    when others then null;
  end;

  return null;
end;
$$;

revoke execute on function public.count_fragment() from public, anon, authenticated;

-- Без списка колонок: `deleted_at` меняет триггер выше, а `update of` видит
-- только колонки из SET запроса.
create trigger on_fragment_counted
  after insert or update on public.message_fragments
  for each row execute function public.count_fragment();

-- =============================================================================
-- Найти или создать свой фрагмент
-- =============================================================================

/**
 * Мой живой фрагмент на этот диапазон сообщения — найденный или новый
 * (спящий до первой реакции или комментария).
 * Проверяет всё, что делает фрагмент фрагментом: сообщение живо, его вид
 * допускает выделение, диапазон внутри текста, `exact_text` — ровно этот кусок
 * текста сейчас. Островок — не текст: выделение на его облачке клиент шлёт на
 * id оригинала.
 */
create function public.ensure_fragment(
  target_message uuid,
  range_start int,
  range_end int,
  range_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  m public.messages;
  existing uuid;
  context int := public.fragment_context_length();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Правка того же сообщения ждёт: смещения считаются от текста, который не
  -- поменяется до конца транзакции.
  select * into m from public.messages where id = target_message for share;

  if m.id is null or m.deleted_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if m.kind not in ('text', 'media', 'voice') or m.text is null then
    raise exception 'this message has no text to select' using errcode = '22023';
  end if;

  if range_start is null or range_end is null or range_start < 0 or range_end <= range_start
     or range_end > char_length(m.text) then
    raise exception 'fragment range is outside the text' using errcode = '22023';
  end if;

  if range_text is distinct from substr(m.text, range_start + 1, range_end - range_start) then
    raise exception 'fragment text does not match the message' using errcode = '22023';
  end if;

  select f.id into existing
  from public.message_fragments f
  where f.message_id = m.id
    and f.author_id = caller
    and f.start_offset = range_start
    and f.end_offset = range_end
    and f.deleted_at is null
    and f.anchor_state <> 'lost';

  if existing is not null then
    return existing;
  end if;

  -- Мой спящий на том же месте — он и проснётся: строк не прибавляется.
  select f.id into existing
  from public.message_fragments f
  where f.message_id = m.id
    and f.author_id = caller
    and f.start_offset = range_start
    and f.end_offset = range_end
    and f.exact_text = range_text
    and f.anchor_state <> 'lost'
  order by f.updated_at desc
  limit 1;

  if existing is not null then
    return existing;
  end if;

  insert into public.message_fragments (
    message_id, chat_id, author_id, start_offset, end_offset, exact_text, prefix_text,
    suffix_text, text_version
  ) values (
    m.id,
    m.chat_id,
    caller,
    range_start,
    range_end,
    range_text,
    substr(m.text, greatest(1, range_start - context + 1), least(range_start, context)),
    substr(m.text, range_end + 1, context),
    coalesce(m.edited_at, m.created_at)
  )
  returning id into existing;

  return existing;
end;
$$;

revoke execute on function public.ensure_fragment(uuid, int, int, text) from public, anon, authenticated;

/** Диапазон из запроса клиента: `{id}` — готовый фрагмент, `{start, end, text}` — свой. */
create function public.fragment_from_request(target_message uuid, fragment jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
begin
  if fragment is null or jsonb_typeof(fragment) = 'null' then
    return null;
  end if;

  if jsonb_typeof(fragment) <> 'object' then
    raise exception 'fragment должен быть json-объектом' using errcode = '22023';
  end if;

  if fragment ? 'id' then
    select f.id into existing
    from public.message_fragments f
    where f.id = (fragment ->> 'id')::uuid
      and f.message_id = target_message;

    if existing is null then
      raise exception 'fragment not found' using errcode = 'P0002';
    end if;

    return existing;
  end if;

  return public.ensure_fragment(
    target_message,
    (fragment ->> 'start')::int,
    (fragment ->> 'end')::int,
    fragment ->> 'text'
  );
end;
$$;

-- Зовёт `post_comment` от имени автора. Сам по себе он создаёт лишь спящий
-- фрагмент, которого никто не видит.
revoke execute on function public.fragment_from_request(uuid, jsonb) from public, anon;
grant execute on function public.fragment_from_request(uuid, jsonb) to authenticated;

-- =============================================================================
-- Реакции на фрагмент
-- =============================================================================

alter table public.reactions drop constraint reactions_target_type_check;
alter table public.reactions
  add constraint reactions_target_type_check
    check (target_type in ('message', 'comment', 'pop', 'fragment'));

-- Посетитель на фрагменте ограничен так же, как на сообщении, но по своему
-- ряду фрагмента.
create or replace function public.reaction_kinds_limit(kind text, audience text)
returns int
language sql
immutable
as $$
  select case when kind in ('message', 'fragment') and audience = 'visitor' then 7 else 20 end
$$;

-- Та же функция, что в 20261010100000_pop_reactions_and_views.sql, плюс
-- фрагмент: чат — чат его сообщения, удалённое сообщение — удалённая цель
-- (спящий фрагмент реакция будит), вид — вид сообщения.
create or replace function public.reaction_target(kind text, target uuid)
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
  union all
  select f.chat_id, m.deleted_at, m.kind, f.message_id, null::uuid
  from public.message_fragments f
  join public.messages m on m.id = f.message_id
  where $1 = 'fragment' and f.id = $2
$$;

revoke execute on function public.reaction_target(text, uuid) from public, anon, authenticated;

-- Та же функция, что в 20261010100000_pop_reactions_and_views.sql, плюс
-- фрагмент: ряд — по участию в чате сообщения, лимит — по ряду фрагмента, как
-- у сообщения.
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
  elsif new.target_type = 'fragment' then
    select f.member_reactions, f.visitor_reactions into member_counts, visitor_counts
    from public.message_fragments f
    where f.id = new.target_id
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
       and (new.target_type not in ('message', 'fragment') or old.audience = new.audience)
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

-- Та же функция, что в 20261011100000_pop_comments.sql, плюс фрагмент: два
-- ряда в строке фрагмента, сигнал — в топик комментариев его сообщения.
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
  fragment_message uuid;
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
  elsif kind = 'fragment' then
    update public.message_fragments
    set
      member_reactions = public.reaction_counts_add(
        public.reaction_counts_add(member_reactions, old_member, -1), new_member, 1
      ),
      visitor_reactions = public.reaction_counts_add(
        public.reaction_counts_add(visitor_reactions, old_visitor, -1), new_visitor, 1
      ),
      reactions_count = greatest(0, reactions_count - was_active::int + is_active::int)
    where id = target
    returning message_id into fragment_message;
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
    elsif kind = 'fragment' and fragment_message is not null then
      perform realtime.send(
        jsonb_build_object('message_id', fragment_message, 'fragment_id', target),
        'fragment_reactions_changed',
        'comments:' || fragment_message::text,
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

-- Та же функция, что в 20261010100000_pop_reactions_and_views.sql, плюс
-- фрагмент. Блокировка — на строке цели, её же обновляет счётчик.
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

  if kind is null or kind not in ('message', 'comment', 'pop', 'fragment') then
    raise exception 'reactions to % are not supported', kind using errcode = '22023';
  end if;

  -- Все реакции на одну цель — по очереди, на строке цели.
  if kind = 'message' then
    perform 1 from public.messages m where m.id = target for no key update;
  elsif kind = 'comment' then
    perform 1 from public.comments c where c.id = target for no key update;
  elsif kind = 'fragment' then
    perform 1 from public.message_fragments f where f.id = target for no key update;
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
 * Реакция на диапазон текста: мой фрагмент на нём — найденный или новый — и
 * реакция на него, одной транзакцией. `reaction = null` снимает мою реакцию с
 * моего фрагмента на этом диапазоне; фрагмента нет — снимать нечего, и новый
 * не создаётся.
 */
create function public.set_fragment_reaction(
  target_message uuid,
  range_start int,
  range_end int,
  range_text text,
  reaction text
)
returns table (fragment_id uuid, emoji text, audience text)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  fragment uuid;
  result record;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if reaction is null then
    select f.id into fragment
    from public.message_fragments f
    where f.message_id = target_message
      and f.author_id = caller
      and f.start_offset = range_start
      and f.end_offset = range_end
      and f.deleted_at is null
      and f.anchor_state <> 'lost';

    if fragment is not null then
      perform public.set_reaction('fragment', fragment, null);
    end if;

    return query select fragment, null::text, null::text;
    return;
  end if;

  fragment := public.ensure_fragment(target_message, range_start, range_end, range_text);

  select * into result from public.set_reaction('fragment', fragment, reaction);

  return query select fragment, result.emoji, result.audience;
end;
$$;

revoke execute on function public.set_fragment_reaction(uuid, int, int, text, text) from public, anon;
grant execute on function public.set_fragment_reaction(uuid, int, int, text, text) to authenticated;

/** Моя реакция на фрагмент — `message_fragments?select=…,my_reaction(emoji)`. */
create function public.my_reaction(public.message_fragments)
returns setof public.reactions
language sql
stable
rows 1
set search_path = public
as $$
  select *
  from public.reactions r
  where r.target_type = 'fragment'
    and r.target_id = $1.id
    and r.user_id = auth.uid()
    and r.deleted_at is null
$$;

revoke execute on function public.my_reaction(public.message_fragments) from public, anon;
grant execute on function public.my_reaction(public.message_fragments) to authenticated;

-- =============================================================================
-- Комментарии к фрагменту
-- =============================================================================

alter table public.comments
  add column fragment_id uuid,
  add constraint comments_fragment_fkey
    foreign key (fragment_id, message_id) references public.message_fragments (id, message_id),
  -- Фрагмент — у верхнеуровневого: ответ в треде к фрагменту не привязывается.
  add constraint comments_fragment_only_root
    check (fragment_id is null or thread_root_id is null);

create index comments_fragment_roots_idx
  on public.comments (fragment_id, rank desc, id desc)
  where fragment_id is not null and thread_root_id is null;

-- `post_comment` — security invoker: вставка идёт под политиками от имени
-- автора. Привязать свой комментарий к живому фрагменту того же сообщения
-- может любой — так и пишут в панели чужого фрагмента; составной ключ не даёт
-- привязать к фрагменту другого сообщения, проверка — к ответу в треде.
grant insert (fragment_id) on public.comments to authenticated;

-- Та же функция, что в 20261011100000_pop_comments.sql, плюс фрагмент: только у
-- верхнеуровневого (то же держит проверка таблицы — здесь понятная ошибка).
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

  if new.fragment_id is not null then
    if new.thread_root_id is not null then
      raise exception 'only a top-level comment can quote a fragment' using errcode = '22023';
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

-- Та же функция, что в 20261011100000_pop_comments.sql, плюс фрагмент: счётчик
-- и во фрагменте (рядом с `messages.comments_count`), а `fragment_id` — в
-- сигнале ветки.
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

    if new.fragment_id is not null then
      update public.message_fragments
      set comments_count = greatest(0, comments_count + delta)
      where id = new.fragment_id;
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
        'thread_root_id', new.thread_root_id,
        'fragment_id', new.fragment_id
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

-- Та же функция, что в 20261011100000_pop_comments.sql, плюс необязательный
-- фрагмент: `{id}` — готовый, `{start, end, text}` — свой, найденный или новый
-- в этой же транзакции. Только у верхнеуровневого и только у сообщения.
drop function public.send_comment(uuid, text, jsonb, uuid[], uuid);
drop function public.send_voice_comment(uuid, jsonb, uuid[], uuid);
drop function public.send_pop_comment(uuid, text, jsonb, uuid[], uuid);
drop function public.send_voice_pop_comment(uuid, jsonb, uuid[], uuid);
drop function public.post_comment(uuid, uuid, text, jsonb, jsonb, uuid[], uuid);

create function public.post_comment(
  target_message uuid,
  target_pop uuid,
  comment_text text,
  media jsonb,
  voice jsonb,
  reply_to uuid[],
  thread_root uuid,
  fragment jsonb default null
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
  fragment_row uuid;
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

  if fragment is not null and jsonb_typeof(fragment) <> 'null' then
    if target_message is null then
      raise exception 'only message text has fragments' using errcode = '22023';
    end if;

    if root is not null then
      raise exception 'only a top-level comment can quote a fragment' using errcode = '22023';
    end if;

    fragment_row := public.fragment_from_request(target_message, fragment);
  end if;

  insert into public.comments (
    chat_id, message_id, pop_id, author_id, kind, text, thread_root_id, fragment_id
  )
  values (
    target_chat,
    target_message,
    target_pop,
    auth.uid(),
    new_kind,
    case when new_kind = 'voice' then null else nullif(btrim(coalesce(comment_text, '')), '') end,
    root,
    fragment_row
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

revoke execute on function public.post_comment(uuid, uuid, text, jsonb, jsonb, uuid[], uuid, jsonb) from public, anon;
grant execute on function public.post_comment(uuid, uuid, text, jsonb, jsonb, uuid[], uuid, jsonb) to authenticated;

create function public.send_comment(
  target_message uuid,
  comment_text text,
  media jsonb default '[]'::jsonb,
  reply_to uuid[] default null,
  thread_root uuid default null,
  fragment jsonb default null
)
returns uuid
language sql
security invoker
set search_path = public
as $$
  select public.post_comment(
    target_message, null, comment_text, media, null, reply_to, thread_root, fragment
  )
$$;

revoke execute on function public.send_comment(uuid, text, jsonb, uuid[], uuid, jsonb) from public, anon;
grant execute on function public.send_comment(uuid, text, jsonb, uuid[], uuid, jsonb) to authenticated;

create function public.send_voice_comment(
  target_message uuid,
  voice jsonb,
  reply_to uuid[] default null,
  thread_root uuid default null,
  fragment jsonb default null
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

  return public.post_comment(target_message, null, null, null, voice, reply_to, thread_root, fragment);
end;
$$;

revoke execute on function public.send_voice_comment(uuid, jsonb, uuid[], uuid, jsonb) from public, anon;
grant execute on function public.send_voice_comment(uuid, jsonb, uuid[], uuid, jsonb) to authenticated;

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

-- Та же функция, что в 20261012110000_comment_roots_keep_pinned.sql, плюс
-- необязательный фильтр по фрагменту: панель фрагмента — те же страницы ранга,
-- только его корни.
drop function public.list_thread_roots(uuid, double precision, uuid, int);
drop function public.list_comment_thread_roots(uuid, double precision, uuid, int);

create function public.list_comment_thread_roots(
  target uuid,
  after_rank double precision default null,
  after_id uuid default null,
  page_size int default 30,
  fragment uuid default null
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
      and (fragment is null or fragment_id = fragment)
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

revoke execute on function public.list_comment_thread_roots(uuid, double precision, uuid, int, uuid) from public, anon;
grant execute on function public.list_comment_thread_roots(uuid, double precision, uuid, int, uuid) to authenticated;

create function public.list_thread_roots(
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

revoke execute on function public.list_thread_roots(uuid, double precision, uuid, int) from public, anon;
grant execute on function public.list_thread_roots(uuid, double precision, uuid, int) to authenticated;

-- =============================================================================
-- Список фрагментов сообщения
-- =============================================================================

/**
 * Живые фрагменты сообщения со счётчиками и моей реакцией. Потерянные — тоже,
 * с `anchor_state = 'lost'`: их комментарии живут, но на тексте их нет.
 */
create function public.list_message_fragments(target_message uuid)
returns table (
  id uuid,
  message_id uuid,
  author_id uuid,
  start_offset int,
  end_offset int,
  exact_text text,
  anchor_state text,
  member_reactions jsonb,
  visitor_reactions jsonb,
  reactions_count int,
  comments_count int,
  my_emoji text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    f.id, f.message_id, f.author_id, f.start_offset, f.end_offset, f.exact_text, f.anchor_state,
    f.member_reactions, f.visitor_reactions, f.reactions_count, f.comments_count,
    (
      select r.emoji from public.reactions r
      where r.target_type = 'fragment' and r.target_id = f.id
        and r.user_id = auth.uid() and r.deleted_at is null
    ),
    f.created_at
  from public.message_fragments f
  join public.messages m on m.id = f.message_id
  where f.message_id = target_message
    and f.deleted_at is null
    and m.deleted_at is null
  order by f.start_offset, f.end_offset, f.created_at
$$;

revoke execute on function public.list_message_fragments(uuid) from public, anon;
grant execute on function public.list_message_fragments(uuid) to authenticated;

-- =============================================================================
-- Перепривязка при правке
-- =============================================================================

/** Длина общего хвоста двух строк — насколько совпал текст перед фрагментом. */
create function public.common_suffix_length(a text, b text)
returns int
language plpgsql
immutable
as $$
declare
  n int := 0;
  la int := char_length(coalesce(a, ''));
  lb int := char_length(coalesce(b, ''));
begin
  while n < la and n < lb and substr(a, la - n, 1) = substr(b, lb - n, 1) loop
    n := n + 1;
  end loop;

  return n;
end;
$$;

/** Длина общего начала двух строк — насколько совпал текст после фрагмента. */
create function public.common_prefix_length(a text, b text)
returns int
language plpgsql
immutable
as $$
declare
  n int := 0;
  la int := char_length(coalesce(a, ''));
  lb int := char_length(coalesce(b, ''));
begin
  while n < la and n < lb and substr(a, n + 1, 1) = substr(b, n + 1, 1) loop
    n := n + 1;
  end loop;

  return n;
end;
$$;

/**
 * Текст сообщения изменился — фрагменты ищутся заново, в той же транзакции.
 * `exact_text` встречается один раз — новое место; несколько — побеждает
 * место, где больше совпало соседнего текста (`prefix_text` / `suffix_text`),
 * при равенстве — ближе к прежнему; ничья или не нашёлся — `lost`. Новое место
 * занято живым фрагментом того же автора — тоже `lost`: слить их значило бы
 * смешать два разных разговора.
 */
create function public.rebind_message_fragments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.message_fragments;
  context int := public.fragment_context_length();
  body text := new.text;
  len int := char_length(coalesce(new.text, ''));
  piece_len int;
  pos int;
  from_pos int;
  best_score int;
  best_distance int;
  best_start int;
  tie boolean;
  score int;
  distance int;
  next_state text;
begin
  for f in
    select * from public.message_fragments
    where message_id = new.id and anchor_state <> 'lost'
    order by created_at, id
  loop
    best_start := null;
    best_score := -1;
    best_distance := null;
    tie := false;
    piece_len := char_length(f.exact_text);

    if body is not null and new.kind in ('text', 'media', 'voice') then
      from_pos := 1;

      loop
        pos := strpos(substr(body, from_pos), f.exact_text);
        exit when pos = 0;
        pos := from_pos + pos - 1;

        score := public.common_suffix_length(
          f.prefix_text, substr(body, greatest(1, pos - context), least(pos - 1, context))
        ) + public.common_prefix_length(
          f.suffix_text, substr(body, pos + piece_len, context)
        );
        distance := abs((pos - 1) - f.start_offset);

        if score > best_score or (score = best_score and distance < best_distance) then
          best_start := pos - 1;
          best_score := score;
          best_distance := distance;
          tie := false;
        elsif score = best_score and distance = best_distance then
          tie := true;
        end if;

        from_pos := pos + 1;
        exit when from_pos > len;
      end loop;
    end if;

    if best_start is null or tie then
      next_state := 'lost';
    elsif exists (
      select 1 from public.message_fragments o
      where o.message_id = f.message_id
        and o.id <> f.id
        and o.author_id is not distinct from f.author_id
        and o.author_id is not null
        and o.start_offset = best_start
        and o.end_offset = best_start + piece_len
        and o.deleted_at is null
        and o.anchor_state <> 'lost'
    ) then
      next_state := 'lost';
    elsif best_start = f.start_offset then
      next_state := f.anchor_state;
    else
      next_state := 'shifted';
    end if;

    if next_state = 'lost' then
      update public.message_fragments set anchor_state = 'lost' where id = f.id;
    else
      update public.message_fragments
      set
        anchor_state = next_state,
        start_offset = best_start,
        end_offset = best_start + piece_len,
        prefix_text = substr(body, greatest(1, best_start - context + 1), least(best_start, context)),
        suffix_text = substr(body, best_start + piece_len + 1, context)
      where id = f.id;
    end if;
  end loop;

  return null;
end;
$$;

revoke execute on function public.rebind_message_fragments() from public, anon, authenticated;

create trigger on_message_text_changed_for_fragments
  after update of text on public.messages
  for each row
  when (old.text is distinct from new.text)
  execute function public.rebind_message_fragments();
