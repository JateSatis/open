-- Кластеры фрагментов (этап 3а): чтение для подсветки и панелей этапа 3б.
--
-- Набор фрагментов для панели — один из трёх:
--   * фрагмент — как в этапе 1;
--   * кластер — все его фрагменты;
--   * выделенная область — фрагменты, больше половины длины которых лежит
--     внутри области.
-- Корни комментариев набора — та же функция `list_comment_thread_roots` с тем
-- же рангом, закреп — `pinned_comment`, если закреплённый — из набора.

-- =============================================================================
-- Наборы фрагментов
-- =============================================================================

/**
 * Видимые фрагменты сообщения, больше половины длины которых — внутри
 * `[area_start, area_end)`. Ровно половина — не входит.
 */
create function public.area_fragment_ids(target_message uuid, area_start int, area_end int)
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  select f.id
  from public.message_fragments f
  where f.message_id = target_message
    and f.deleted_at is null
    and f.anchor_state <> 'lost'
    and f.start_offset < area_end
    and f.end_offset > area_start
    and 2 * (least(f.end_offset, area_end) - greatest(f.start_offset, area_start)) > f.end_offset - f.start_offset
$$;

revoke execute on function public.area_fragment_ids(uuid, int, int) from public, anon;
grant execute on function public.area_fragment_ids(uuid, int, int) to authenticated;

/** Фрагменты набора: фрагмент, кластер или область; ничего не задано — null (все). */
create function public.fragment_set_ids(
  target_message uuid,
  fragment uuid,
  cluster uuid,
  area_start int,
  area_end int
)
returns uuid[]
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when fragment is not null then array[fragment]
    when cluster is not null then array(
      select f.id from public.message_fragments f
      where f.cluster_id = cluster and f.message_id = target_message and f.deleted_at is null
    )
    when area_start is not null and area_end is not null then array(
      select public.area_fragment_ids(target_message, area_start, area_end)
    )
  end
$$;

revoke execute on function public.fragment_set_ids(uuid, uuid, uuid, int, int) from public, anon;
grant execute on function public.fragment_set_ids(uuid, uuid, uuid, int, int) to authenticated;

-- =============================================================================
-- Кластеры сообщения
-- =============================================================================

/**
 * Отображаемые кластеры сообщения: диапазон на тексте (code points) и его
 * цитата, сводные счётчики и моя реакция в кластере. Удалённое сообщение
 * кластеров не отдаёт (политика таблицы).
 */
create function public.list_message_clusters(target_message uuid)
returns table (
  id uuid,
  message_id uuid,
  start_offset int,
  end_offset int,
  display_start int,
  display_end int,
  display_text text,
  popularity double precision,
  member_reactions jsonb,
  visitor_reactions jsonb,
  reactions_count int,
  comments_count int,
  people_count int,
  fragments_count int,
  my_emoji text,
  my_fragment_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    k.id, k.message_id, k.start_offset, k.end_offset, k.display_start, k.display_end,
    substr(m.text, k.display_start + 1, k.display_end - k.display_start),
    k.popularity, k.member_reactions, k.visitor_reactions, k.reactions_count, k.comments_count,
    k.people_count,
    (
      select count(*)::int from public.message_fragments f
      where f.cluster_id = k.id and f.deleted_at is null
    ),
    mine.emoji,
    mine.target_id
  from public.fragment_clusters k
  join public.messages m on m.id = k.message_id
  left join lateral (
    select r.emoji, r.target_id
    from public.reactions r
    join public.message_fragments f on f.id = r.target_id
    where r.target_type = 'fragment'
      and r.user_id = auth.uid()
      and r.deleted_at is null
      and f.cluster_id = k.id
    order by r.updated_at desc
    limit 1
  ) mine on true
  where k.message_id = target_message
  order by k.display_start
$$;

revoke execute on function public.list_message_clusters(uuid) from public, anon;
grant execute on function public.list_message_clusters(uuid) to authenticated;

/**
 * Сводка выделенной области для панели: фрагменты (больше половины внутри),
 * их реакции по эмодзи, комментарии, люди и цитата области.
 */
create function public.fragment_area_summary(target_message uuid, area_start int, area_end int)
returns table (
  fragment_ids uuid[],
  area_text text,
  member_reactions jsonb,
  visitor_reactions jsonb,
  reactions_count int,
  comments_count int,
  people_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  with area as (
    select f.*
    from public.message_fragments f
    where f.id in (select public.area_fragment_ids(target_message, area_start, area_end))
  )
  select
    coalesce((select array_agg(a.id order by a.start_offset, a.end_offset, a.id) from area a), '{}'),
    (
      select substr(m.text, greatest(area_start, 0) + 1, greatest(area_end - greatest(area_start, 0), 0))
      from public.messages m where m.id = target_message
    ),
    (
      select coalesce(jsonb_object_agg(e.key, e.total), '{}'::jsonb)
      from (
        select x.key, sum(x.value::int) as total
        from area a, jsonb_each_text(a.member_reactions) x group by x.key
      ) e
    ),
    (
      select coalesce(jsonb_object_agg(e.key, e.total), '{}'::jsonb)
      from (
        select x.key, sum(x.value::int) as total
        from area a, jsonb_each_text(a.visitor_reactions) x group by x.key
      ) e
    ),
    coalesce((select sum(a.reactions_count)::int from area a), 0),
    coalesce((select sum(a.comments_count)::int from area a), 0),
    (
      select count(distinct v.user_id)::int
      from (
        select r.user_id
        from area a
        join public.reactions r on r.target_type = 'fragment' and r.target_id = a.id and r.deleted_at is null
        union all
        select c.author_id
        from area a
        join public.comments c on c.fragment_id = a.id and c.deleted_at is null
      ) v
      where v.user_id is not null
    )
$$;

revoke execute on function public.fragment_area_summary(uuid, int, int) from public, anon;
grant execute on function public.fragment_area_summary(uuid, int, int) to authenticated;

-- =============================================================================
-- Фрагменты сообщения — с кластером
-- =============================================================================

-- Та же функция, что в 20261022100000_message_fragments.sql, плюс кластер
-- фрагмента.
drop function public.list_message_fragments(uuid);

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
  created_at timestamptz,
  cluster_id uuid
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
    f.created_at,
    f.cluster_id
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
-- Корни комментариев и закреп набора
-- =============================================================================

-- Та же функция, что в 20261022100000_message_fragments.sql, но фильтр — по
-- набору фрагментов: один фрагмент, кластер или область. Ранг тот же.
drop function public.list_comment_thread_roots(uuid, double precision, uuid, int, uuid);

create function public.list_comment_thread_roots(
  target uuid,
  after_rank double precision default null,
  after_id uuid default null,
  page_size int default 30,
  fragment uuid default null,
  cluster uuid default null,
  area_start int default null,
  area_end int default null
)
returns setof public.comments
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.comments;
  fragments uuid[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  fragments := public.fragment_set_ids(target, fragment, cluster, area_start, area_end);

  for c in
    select *
    from public.comments
    where target_id = target
      and thread_root_id is null
      and (fragments is null or fragment_id = any (fragments))
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

revoke execute on function public.list_comment_thread_roots(uuid, double precision, uuid, int, uuid, uuid, int, int) from public, anon;
grant execute on function public.list_comment_thread_roots(uuid, double precision, uuid, int, uuid, uuid, int, int) to authenticated;

-- Та же функция, что в 20261012100000_comment_pins_and_pop_forwards.sql, плюс
-- набор: закреплённый отдаётся, только если он — комментарий фрагмента набора.
drop function public.pinned_comment(uuid);

create function public.pinned_comment(
  target uuid,
  fragment uuid default null,
  cluster uuid default null,
  area_start int default null,
  area_end int default null
)
returns setof public.comments
language sql
stable
security invoker
set search_path = public
as $$
  select c.*
  from public.comment_pins p
  join public.comments c on c.id = p.comment_id
  where p.target_id = target
    and p.deleted_at is null
    and c.deleted_at is null
    and (
      num_nonnulls(fragment, cluster, area_start) = 0
      or c.fragment_id = any (public.fragment_set_ids(target, fragment, cluster, area_start, area_end))
    )
$$;

revoke execute on function public.pinned_comment(uuid, uuid, uuid, int, int) from public, anon;
grant execute on function public.pinned_comment(uuid, uuid, uuid, int, int) to authenticated;
