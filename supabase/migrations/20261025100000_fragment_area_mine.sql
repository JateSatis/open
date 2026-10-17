-- Кластеры фрагментов (этап 3б): моя реакция в панели выделенной области.
--
-- Тап по реакции в панели области ставит её на мой фрагмент ровно этой
-- области — и база заменяет мою прежнюю реакцию в кластере, куда этот
-- фрагмент попадёт. Панель заранее отмечает именно ту реакцию, которую тап
-- заменит: мою в этом кластере. Кластер — по тому же правилу, что у
-- `ensure_fragment` / `attach_fragment`: мой живой фрагмент этой области уже в
-- кластере — его кластер; иначе кластер с наибольшим пересечением диапазона
-- модели (при равенстве — старший). Кластера нет — моя реакция на моём
-- фрагменте ровно этой области, если он есть.

-- =============================================================================
-- Мой кластер области и моя реакция в нём
-- =============================================================================

/**
 * Куда попадёт мой фрагмент области `[area_start, area_end)` и какая моя
 * реакция там стоит. Кластер может быть и не отображаемым: RLS таблицы
 * кластеров отдаёт только отображаемые, а правило привязки — по всем, поэтому
 * definer. Наружу — только своё и id кластера (он и так виден у фрагментов).
 */
create function public.fragment_area_mine(target_message uuid, area_start int, area_end int)
returns table (cluster_id uuid, my_emoji text, my_fragment_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  exact public.message_fragments;
  cluster uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (select 1 from public.messages m where m.id = target_message and m.deleted_at is null) then
    return;
  end if;

  select * into exact
  from public.message_fragments f
  where f.message_id = target_message
    and f.author_id = caller
    and f.start_offset = area_start
    and f.end_offset = area_end
    and f.deleted_at is null
    and f.anchor_state <> 'lost';

  cluster := exact.cluster_id;

  if cluster is null then
    select k.id into cluster
    from public.fragment_clusters k
    where k.message_id = target_message
      and k.deleted_at is null
      and k.start_offset < area_end
      and k.end_offset > area_start
    order by
      least(k.end_offset, area_end) - greatest(k.start_offset, area_start) desc,
      k.created_at,
      k.id
    limit 1;
  end if;

  return query
  select cluster, r.emoji, r.target_id
  from public.reactions r
  join public.message_fragments f on f.id = r.target_id
  where r.target_type = 'fragment'
    and r.user_id = caller
    and r.deleted_at is null
    and f.message_id = target_message
    and f.deleted_at is null
    and (case when cluster is not null then f.cluster_id = cluster else f.id = exact.id end)
  order by r.updated_at desc
  limit 1;

  if not found then
    return query select cluster, null::text, null::uuid;
  end if;
end;
$$;

revoke execute on function public.fragment_area_mine(uuid, int, int) from public, anon;
grant execute on function public.fragment_area_mine(uuid, int, int) to authenticated;

-- =============================================================================
-- Сводка области — плюс моё
-- =============================================================================

-- Та же функция, что в 20261023130000_fragment_cluster_reads.sql, плюс моя
-- реакция по правилу выше.
drop function public.fragment_area_summary(uuid, int, int);

create function public.fragment_area_summary(target_message uuid, area_start int, area_end int)
returns table (
  fragment_ids uuid[],
  area_text text,
  member_reactions jsonb,
  visitor_reactions jsonb,
  reactions_count int,
  comments_count int,
  people_count int,
  my_cluster_id uuid,
  my_emoji text,
  my_fragment_id uuid
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
  ),
  mine as (
    select * from public.fragment_area_mine(target_message, area_start, area_end)
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
    ),
    (select mine.cluster_id from mine),
    (select mine.my_emoji from mine),
    (select mine.my_fragment_id from mine)
$$;

revoke execute on function public.fragment_area_summary(uuid, int, int) from public, anon;
grant execute on function public.fragment_area_summary(uuid, int, int) to authenticated;
