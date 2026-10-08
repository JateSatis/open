-- Реакции в облачке: кто поставил и сколько разных.
--
-- Облачко рисует реакции участников крупным рядом, под эмодзи — число или
-- аватары одного-двух поставивших, а реакции зрителей — строкой, которая
-- обязана влезать в облачко без прокрутки. Отсюда два изменения:
--
-- 1. Вычисляемая связь `reactors`: для эмодзи с одним-двумя поставившими —
--    их строки реакций (с них клиент встраивает профиль). Связью, а не полем
--    в строке цели: аватар не устаревает, а триггеру не нужно пересчитывать
--    «кто остался вторым», когда третий снял реакцию.
--
-- 2. Лимит разных реакций — инвариант: восьмая реакция зрителей ломает
--    строку, которая обязана влезать. У сообщения — 20 разных в ряду
--    участников и 7 в ряду зрителей, у комментария — 20 разных в обоих рядах
--    вместе (у него один общий ряд). Реакция, которая уже есть в своём ряду,
--    проходит всегда; место освобождается, когда ключ исчез из счётчиков.

-- =============================================================================
-- Лимит
-- =============================================================================

/** Сколько разных реакций может быть в ряду цели. */
create function public.reaction_kinds_limit(kind text, audience text)
returns int
language sql
immutable
as $$
  select case when kind = 'message' and audience = 'visitor' then 7 else 20 end
$$;

/** Счётчики двух рядов, сложенные в один: «реакция → число». */
create function public.reaction_counts_merge(a jsonb, b jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(key, total), '{}'::jsonb)
  from (
    select key, sum(value::int) as total
    from (
      select * from jsonb_each_text(a)
      union all
      select * from jsonb_each_text(b)
    ) both_rows
    group by key
  ) merged
$$;

-- Та же функция, что в 20261004110000_comment_forwards.sql, плюс лимит
-- разных реакций. Строка цели берётся `for no key update`, как в
-- `set_reaction`: прямая вставка в `reactions` разрешена, и без блокировки
-- две одновременные разные реакции обе прошли бы проверку. Счётчики, которые
-- проверяются, обновляет `count_reaction` после вставки под той же
-- блокировкой — следующая вставка увидит уже их.
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
  new.audience := case
    when exists (
      select 1 from public.chat_members
      where chat_id = target.chat_id and user_id = new.user_id
    ) then 'member'
    else 'visitor'
  end;

  if new.target_type = 'message' then
    select m.member_reactions, m.visitor_reactions into member_counts, visitor_counts
    from public.messages m
    where m.id = new.target_id
    for no key update;

    counts := case when new.audience = 'member' then member_counts else visitor_counts end;
  else
    select c.member_reactions, c.visitor_reactions into member_counts, visitor_counts
    from public.comments c
    where c.id = new.target_id
    for no key update;

    counts := public.reaction_counts_merge(member_counts, visitor_counts);
  end if;

  if not counts ? new.emoji then
    select count(*) into taken from jsonb_object_keys(counts);

    -- Смена моей реакции: если я был единственным у прежней, её место
    -- освобождается тем же движением.
    if tg_op = 'UPDATE' and old.deleted_at is null and old.emoji <> new.emoji
       and (new.target_type = 'comment' or old.audience = new.audience)
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

revoke execute on function public.reaction_kinds_limit(text, text) from public, anon;
grant execute on function public.reaction_kinds_limit(text, text) to authenticated;

-- =============================================================================
-- Кто поставил
-- =============================================================================

-- Поставившие эмодзи — по цели и эмодзи, не больше двух строк на эмодзи.
create index reactions_target_emoji_idx
  on public.reactions (target_type, target_id, emoji, updated_at)
  where deleted_at is null;

/**
 * Вычисляемая связь для PostgREST: `messages?select=…,reactors(emoji,…)`.
 * Строки реакций участников у эмодзи, которые поставили один-два человека, —
 * в порядке постановки. Эмодзи берутся из счётчиков в самой строке, поэтому
 * на горячем сообщении с тысячами реакций читается не больше 40 строк.
 */
create function public.reactors(public.messages)
returns setof public.reactions
language sql
stable
rows 40
set search_path = public
as $$
  select r.*
  from jsonb_each_text($1.member_reactions) e
  cross join lateral (
    select *
    from public.reactions x
    where x.target_type = 'message'
      and x.target_id = $1.id
      and x.emoji = e.key
      and x.audience = 'member'
      and x.deleted_at is null
    order by x.updated_at
    limit 2
  ) r
  where e.value::int <= 2
$$;

/** То же для комментария: у него ряд общий, поэтому — по обоим рядам вместе. */
create function public.reactors(public.comments)
returns setof public.reactions
language sql
stable
rows 40
set search_path = public
as $$
  select r.*
  from jsonb_each_text(public.reaction_counts_merge($1.member_reactions, $1.visitor_reactions)) e
  cross join lateral (
    select *
    from public.reactions x
    where x.target_type = 'comment'
      and x.target_id = $1.id
      and x.emoji = e.key
      and x.deleted_at is null
    order by x.updated_at
    limit 2
  ) r
  where e.value::int <= 2
$$;

revoke execute on function public.reactors(public.messages) from public, anon;
grant execute on function public.reactors(public.messages) to authenticated;
revoke execute on function public.reactors(public.comments) from public, anon;
grant execute on function public.reactors(public.comments) to authenticated;
