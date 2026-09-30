-- Реакции.
--
-- Реакцию ставит кто угодно и где угодно: и участник, и посетитель, во всех
-- чатах, всегда. Но в облачке они живут в разных рядах, и ряд определяет
-- база — по `chat_members` в момент, когда реакция ставится или меняется.
-- Клиент ряд не выбирает: посетитель, объявивший себя участником прямым
-- запросом, всё равно окажется в ряду посетителей.
--
-- Цель полиморфная (`target_type` + `target_id`): пока это только сообщение,
-- следом придут комментарии. Внешнего ключа у такой связи нет, поэтому
-- существование цели проверяет триггер.
--
-- Удаление мягкое, но строк на человека и цель не больше одной: снятая
-- реакция получает `deleted_at`, а поставленная снова оживляет ту же строку.
-- Реакции переключают часто, и история каждого переключения ничего не
-- рассказывает (набор фиксирован, написать реакцией ничего нельзя), зато
-- раздувала бы таблицу на горячих сообщениях без предела.

-- =============================================================================
-- Набор
-- =============================================================================
--
-- Реакция рисуется на чужом облачке у всех зрителей. Произвольная строка,
-- записанная прямым запросом, была бы способом написать что угодно на чужом
-- сообщении, поэтому набор — инвариант базы: внешний ключ на справочник.
-- Меняется набор только миграцией; тот же список лежит в клиенте
-- (`src/features/interactions/reactionSet.ts`), и тест сверяет их.

create table public.reaction_emojis (
  id uuid primary key default gen_random_uuid (),
  emoji text not null unique,
  /** Порядок в полном наборе. */
  position smallint not null unique,
  /** Основные — в свёрнутой полосе меню. */
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.reaction_emojis enable row level security;

create policy "reaction_emojis are readable by authenticated users"
  on public.reaction_emojis for select
  to authenticated
  using (true);

revoke insert, update, delete on public.reaction_emojis from anon, authenticated;

insert into public.reaction_emojis (emoji, position, is_primary) values
  ('👍', 1, true),
  ('👎', 2, true),
  ('❤️', 3, true),
  ('🔥', 4, true),
  ('🥰', 5, true),
  ('👏', 6, true),
  ('😁', 7, true),
  ('🤔', 8, false),
  ('🤯', 9, false),
  ('😱', 10, false),
  ('🤬', 11, false),
  ('😢', 12, false),
  ('🎉', 13, false),
  ('🤩', 14, false),
  ('🤮', 15, false),
  ('💩', 16, false),
  ('🙏', 17, false),
  ('👌', 18, false),
  ('🕊️', 19, false),
  ('🤡', 20, false),
  ('🥱', 21, false),
  ('🥴', 22, false),
  ('😍', 23, false),
  ('🐳', 24, false),
  ('❤️‍🔥', 25, false),
  ('🌚', 26, false),
  ('🌭', 27, false),
  ('💯', 28, false),
  ('🤣', 29, false),
  ('⚡', 30, false),
  ('🍌', 31, false),
  ('🏆', 32, false),
  ('💔', 33, false),
  ('🤨', 34, false),
  ('😐', 35, false),
  ('🍓', 36, false),
  ('🍾', 37, false),
  ('💋', 38, false),
  ('😈', 39, false),
  ('😴', 40, false),
  ('😭', 41, false),
  ('🤓', 42, false),
  ('👻', 43, false),
  ('👨‍💻', 44, false),
  ('👀', 45, false),
  ('🎃', 46, false),
  ('🙈', 47, false),
  ('😇', 48, false),
  ('😨', 49, false),
  ('🤝', 50, false),
  ('✍️', 51, false),
  ('🤗', 52, false),
  ('🫡', 53, false),
  ('🎅', 54, false),
  ('🎄', 55, false),
  ('☃️', 56, false),
  ('💅', 57, false),
  ('🤪', 58, false),
  ('🗿', 59, false),
  ('🆒', 60, false),
  ('💘', 61, false),
  ('🙉', 62, false),
  ('🦄', 63, false),
  ('😘', 64, false),
  ('💊', 65, false),
  ('🙊', 66, false),
  ('😎', 67, false),
  ('👾', 68, false),
  ('🤷', 69, false),
  ('😡', 70, false);

-- =============================================================================
-- Счётчики на сообщении
-- =============================================================================
--
-- Денормализованно, по рядам: «реакция → число» у участников и у
-- посетителей, плюс общее число — сигнал вовлечённости для ленты. Горячее
-- сообщение с тысячами реакций — обычный случай, агрегат на каждый запрос
-- считать нельзя. Пишет только триггер: прямого UPDATE у клиента нет с
-- миграции правки.

alter table public.messages
  add column member_reactions jsonb not null default '{}'::jsonb,
  add column visitor_reactions jsonb not null default '{}'::jsonb,
  add column reactions_count int not null default 0;

-- =============================================================================
-- reactions
-- =============================================================================

create table public.reactions (
  id uuid primary key default gen_random_uuid (),
  /** Комментарии разрешены схемой заранее, но триггер их пока не принимает — таблицы ещё нет. */
  target_type text not null check (target_type in ('message', 'comment')),
  target_id uuid not null,
  /** Чат, где живёт цель: по нему идёт рассылка. Ставит триггер. */
  chat_id uuid references public.chats (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  emoji text not null references public.reaction_emojis (emoji),
  /** Ряд: участник чата или посетитель. Ставит только триггер. */
  audience text not null default 'visitor' check (audience in ('member', 'visitor')),
  created_at timestamptz not null default now(),
  /** Когда реакцию поставили или поменяли в последний раз. */
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Одна живая реакция на человека и цель. Этот же индекс отвечает на «моя
-- реакция на сообщение» при выборке страницы переписки.
create unique index reactions_one_per_user_key
  on public.reactions (target_type, target_id, user_id)
  where deleted_at is null;

create index reactions_user_id_idx on public.reactions (user_id);

alter table public.reactions enable row level security;

create policy "reactions are readable by authenticated users"
  on public.reactions for select
  to authenticated
  using (deleted_at is null);

-- Поставить реакцию может любой аутентифицированный — это правило продукта.
-- Прямая вставка разрешена и защищена триггером ниже: ряд, чат и живость
-- цели он ставит и проверяет сам, что бы ни пришло в запросе. Обычный путь —
-- функция `set_reaction`: она же меняет и снимает.
create policy "reactions are added by their author"
  on public.reactions for insert
  to authenticated
  with check (auth.uid() = user_id);

revoke insert, update, delete on public.reactions from anon, authenticated;
grant insert (target_type, target_id, user_id, emoji, audience, chat_id) on public.reactions
  to authenticated;

/**
 * Цель жива, ряд — по участию в чате. На вставку и на любую смену реакции:
 * другую реакцию, повторную постановку снятой. Цель у строки не меняется.
 */
create function public.prepare_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_chat uuid;
  target_deleted timestamptz;
  revived boolean;
begin
  if tg_op = 'UPDATE' then
    if new.target_type is distinct from old.target_type or new.target_id is distinct from old.target_id then
      raise exception 'reaction target cannot change' using errcode = '42501';
    end if;

    revived := old.deleted_at is not null and new.deleted_at is null;

    -- Снятие и смена владельца (аккаунт удалён) ряд не пересчитывают.
    if new.emoji is not distinct from old.emoji and not revived then
      new.audience := old.audience;
      new.chat_id := old.chat_id;
      return new;
    end if;
  else
    new.deleted_at := null;
    new.created_at := now();
  end if;

  if new.target_type <> 'message' then
    raise exception 'reactions to % are not supported yet', new.target_type
      using errcode = '22023';
  end if;

  select chat_id, deleted_at into target_chat, target_deleted
  from public.messages
  where id = new.target_id;

  if target_chat is null or target_deleted is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  new.chat_id := target_chat;
  new.updated_at := now();
  new.audience := case
    when exists (
      select 1 from public.chat_members
      where chat_id = target_chat and user_id = new.user_id
    ) then 'member'
    else 'visitor'
  end;

  return new;
end;
$$;

create trigger on_reaction_written
  before insert or update on public.reactions
  for each row execute function public.prepare_reaction();

/** Прибавляет `delta` к числу у реакции; ноль и меньше убирают ключ. `emoji` null — без изменений. */
create function public.reaction_counts_add(counts jsonb, emoji text, delta int)
returns jsonb
language sql
immutable
as $$
  select case
    when emoji is null then counts
    when coalesce((counts ->> emoji)::int, 0) + delta <= 0 then counts - emoji
    else jsonb_set(counts, array[emoji], to_jsonb(coalesce((counts ->> emoji)::int, 0) + delta))
  end
$$;

/**
 * Счётчики на сообщении и сигнал в топик чата. Одним UPDATE строки
 * сообщения: смена реакции — минус старая и плюс новая сразу. Этот UPDATE
 * берёт блокировку строки, поэтому одновременные реакции разных людей идут
 * по очереди и не теряют друг друга.
 */
create function public.count_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_active boolean := tg_op <> 'INSERT' and old.deleted_at is null;
  is_active boolean := tg_op <> 'DELETE' and new.deleted_at is null;
  target uuid := coalesce(new.target_id, old.target_id);
  target_chat uuid := coalesce(new.chat_id, old.chat_id);
  old_member text;
  old_visitor text;
  new_member text;
  new_visitor text;
begin
  if coalesce(new.target_type, old.target_type) <> 'message' then
    return null;
  end if;

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

  -- Payload — сигнал: счётчики клиент перечитывает из базы, пачкой.
  begin
    perform realtime.send(
      jsonb_build_object('chat_id', target_chat, 'message_id', target),
      'reactions_changed',
      'chat:' || target_chat::text,
      true
    );
  exception
    when others then null;
  end;

  return null;
end;
$$;

create trigger on_reaction_changed
  after insert or update or delete on public.reactions
  for each row execute function public.count_reaction();

-- =============================================================================
-- Поставить, поменять, снять
-- =============================================================================

/**
 * Приводит мою реакцию на цель к `reaction`: ставит, меняет или снимает
 * (`null`). Идемпотентна: повтор того же вызова ничего не меняет, поэтому
 * клиент может спокойно повторить запрос, ответ на который потерялся.
 * «Повтор той же снимает» — это жест в интерфейсе, он превращается в вызов
 * с `null`.
 *
 * Отдаёт, какой стала моя реакция и в каком она ряду; `null` — снята.
 *
 * Security definer, потому что меняет и снимает, а UPDATE у клиента нет.
 * Строка — всегда своя: она ищется по `auth.uid()`, чужую не тронуть.
 */
create function public.set_reaction(target_type text, target_id uuid, reaction text)
returns table (emoji text, audience text)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  kind text := target_type;
  target uuid := target_id;
  current_row public.reactions;
  dormant uuid;
  result public.reactions;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if kind <> 'message' then
    raise exception 'reactions to % are not supported yet', kind using errcode = '22023';
  end if;

  -- Все реакции на одно сообщение — по очереди, на строке сообщения: её же
  -- обновляет счётчик, так что лишнего ожидания это не добавляет.
  perform 1 from public.messages m
  where m.id = target and m.deleted_at is null
  for no key update;

  if not found then
    raise exception 'message not found' using errcode = 'P0002';
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

revoke execute on function public.set_reaction(text, uuid, text) from public, anon;
grant execute on function public.set_reaction(text, uuid, text) to authenticated;

-- Служебное — не для прямого вызова.
revoke execute on function public.prepare_reaction() from public, anon, authenticated;
revoke execute on function public.count_reaction() from public, anon, authenticated;

-- =============================================================================
-- Моя реакция в выборке сообщений
-- =============================================================================

/**
 * Вычисляемая связь для PostgREST: `messages?select=…,my_reaction(emoji,audience)`.
 * Своя реакция приходит той же выборкой, что и страница переписки, — один
 * запрос на страницу, без догрузки на каждое облачко. Ищется по уникальному
 * индексу `reactions_one_per_user_key`.
 */
create function public.my_reaction(public.messages)
returns setof public.reactions
language sql
stable
rows 1
set search_path = public
as $$
  select *
  from public.reactions r
  where r.target_type = 'message'
    and r.target_id = $1.id
    and r.user_id = auth.uid()
    and r.deleted_at is null
$$;

revoke execute on function public.my_reaction(public.messages) from public, anon;
grant execute on function public.my_reaction(public.messages) to authenticated;
