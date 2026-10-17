-- Лидер кластера, доработка по ревью.
--
-- 1. Замена моей реакции в кластере идёт в два шага: `replace_cluster_reaction`
--    снимает прежнюю, затем добавляется новая. Ничья сравнивалась с лидером
--    промежуточного состояния, и лидер мог смениться при тех же итоговых
--    числах. Пока прежняя снимается (флаг `open.cluster_reaction_replaced`),
--    лидер не пересчитывается — новая реакция сравнит итог с лидером до замены.
-- 2. Пересчёт модели сигналит только о смене отображаемого набора. Сменил он
--    лидера показанного кластера (фрагменты переложились) — сигнал тоже.
-- 3. Ничья вне справочника — по code points, как у клиента, а не по collation.

create or replace function public.cluster_dominant_reaction(member jsonb, visitor jsonb, previous text)
returns text
language sql
stable
set search_path = public
as $$
  with totals as (
    select key, sum(value::int) as total
    from (
      select key, value from jsonb_each_text(coalesce(member, '{}'::jsonb))
      union all
      select key, value from jsonb_each_text(coalesce(visitor, '{}'::jsonb))
    ) parts
    group by key
    having sum(value::int) > 0
  ),
  leaders as (
    select t.key, e.position
    from totals t
    left join public.reaction_emojis e on e.emoji = t.key
    where t.total = (select max(total) from totals)
  )
  select case
    when exists (select 1 from leaders l where l.key = previous) then previous
    else (select l.key from leaders l order by l.position nulls last, l.key collate "C" limit 1)
  end
$$;

create or replace function public.set_cluster_dominant()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('open.cluster_reaction_replaced', true), '') = 'on' then
    new.dominant_emoji := old.dominant_emoji;
    return new;
  end if;

  new.dominant_emoji := public.cluster_dominant_reaction(
    new.member_reactions,
    new.visitor_reactions,
    case when tg_op = 'UPDATE' then old.dominant_emoji end
  );

  return new;
end;
$$;

create or replace function public.signal_cluster_look()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null or new.display_start is null then
    return null;
  end if;

  -- Пересчёт модели сам сигналит о новом наборе; лидер — только здесь.
  if public.fragment_clusters_writing() then
    if old.dominant_emoji is not distinct from new.dominant_emoji then
      return null;
    end if;
  elsif (old.dominant_emoji, old.reactions_count) is not distinct from (new.dominant_emoji, new.reactions_count) then
    return null;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', new.chat_id, 'message_id', new.message_id),
      'clusters_changed',
      'chat:' || new.chat_id::text,
      true
    );
  exception
    when others then null;
  end;

  return null;
end;
$$;
