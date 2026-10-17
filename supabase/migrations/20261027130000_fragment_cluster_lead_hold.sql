-- Лидер кластера: заморозка на время замены реакции — только для замены.
--
-- Флаг `open.cluster_reaction_replaced` ставит и `fragment_clusters_dedup`, а
-- там дубли просто снимаются, новой реакции следом нет — замороженный лидер
-- так бы и остался. Замена (`replace_cluster_reaction`) ставит свой флаг
-- `open.cluster_lead_hold`, и лидер ждёт только его.

create or replace function public.set_cluster_dominant()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('open.cluster_lead_hold', true), '') = 'on' then
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

revoke execute on function public.cluster_dominant_reaction(jsonb, jsonb, text) from public, anon;

-- Та же функция, что в 20261023100000_fragment_clusters.sql, плюс флаг
-- заморозки лидера на время снятия прежней реакции.
create or replace function public.replace_cluster_reaction(fragment uuid, reactor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_message uuid;
  cluster uuid;
  victims uuid[];
begin
  if fragment is null or reactor is null then
    return;
  end if;

  select message_id into target_message from public.message_fragments where id = fragment;

  if target_message is null then
    return;
  end if;

  perform public.lock_fragment_clusters_shared(target_message);

  select cluster_id into cluster from public.message_fragments where id = fragment;

  if cluster is null then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('fragment_cluster_reaction:' || cluster::text || ':' || reactor::text, 0)
  );

  select array_agg(r.id) into victims
  from public.reactions r
  join public.message_fragments f on f.id = r.target_id
  where r.target_type = 'fragment'
    and r.user_id = reactor
    and r.deleted_at is null
    and r.target_id <> fragment
    and f.cluster_id = cluster;

  if victims is null then
    return;
  end if;

  perform 1
  from public.message_fragments f
  where f.id = fragment
     or f.id in (select r.target_id from public.reactions r where r.id = any (victims))
  order by f.id
  for no key update;

  -- Замена — одно взаимодействие, а не два.
  perform set_config('open.cluster_reaction_replaced', 'on', true);
  -- ������ ������� ����� ������� � ��� � ������� ���� � ������� �� ������.
  perform set_config('open.cluster_lead_hold', 'on', true);

  update public.reactions set deleted_at = now() where id = any (victims);

  perform set_config('open.cluster_reaction_replaced', '', true);
  perform set_config('open.cluster_lead_hold', '', true);
end;
$$;
