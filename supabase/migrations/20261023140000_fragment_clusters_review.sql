-- Кластеры фрагментов, доработка по ревью.
--
-- 1. Голоса кластера переживают удаление аккаунта: ссылка на профиль —
--    `on delete set null`, как у всей публичной истории; голос удалённого
--    аккаунта — отдельный человек (как в модели).
-- 2. Обработчик может поставить заявку сам: если схлопывание реакций после
--    записи не прошло, пересчёт повторится.
-- 3. После правки текста диапазон кластера — по оставшимся в нём фрагментам,
--    а не по прежнему тексту: новый фрагмент не войдёт в кластер по старому
--    месту. Кластер без фрагментов гаснет.
-- 4. Будильник не запускает второй обработчик, пока работает первый.

-- =============================================================================
-- 1. Голоса удалённых аккаунтов
-- =============================================================================

alter table public.fragment_cluster_voters
  alter column user_id drop not null,
  drop constraint fragment_cluster_voters_user_id_fkey,
  add constraint fragment_cluster_voters_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete set null;

-- Та же функция, что в 20261023100000_fragment_clusters.sql, но люди
-- считаются по голосам, а не по таблице голосовавших: голос удалённого
-- аккаунта — отдельный человек.
create or replace function public.refresh_message_clusters(target_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.fragment_cluster_voters v
  using public.fragment_clusters k
  where k.id = v.cluster_id and k.message_id = target_message;

  insert into public.fragment_cluster_voters (cluster_id, user_id, votes)
  select f.cluster_id, x.user_id, count(*)
  from public.message_fragments f
  cross join lateral (
    select r.user_id
    from public.reactions r
    where r.target_type = 'fragment' and r.target_id = f.id and r.deleted_at is null
    union all
    select c.author_id
    from public.comments c
    where c.fragment_id = f.id and c.deleted_at is null
  ) x
  where f.message_id = target_message
    and f.cluster_id is not null
    and f.deleted_at is null
    and x.user_id is not null
  group by f.cluster_id, x.user_id;

  update public.fragment_clusters k
  set
    member_reactions = coalesce(s.member_reactions, '{}'::jsonb),
    visitor_reactions = coalesce(s.visitor_reactions, '{}'::jsonb),
    reactions_count = coalesce(s.reactions_count, 0),
    comments_count = coalesce(s.comments_count, 0),
    people_count = coalesce(p.people, 0),
    updated_at = now()
  from public.fragment_clusters base
  left join lateral (
    select
      (
        select coalesce(jsonb_object_agg(e.key, e.total), '{}'::jsonb)
        from (
          select m.key, sum(m.value::int) as total
          from public.message_fragments f2, jsonb_each_text(f2.member_reactions) m
          where f2.cluster_id = base.id and f2.deleted_at is null
          group by m.key
        ) e
      ) as member_reactions,
      (
        select coalesce(jsonb_object_agg(e.key, e.total), '{}'::jsonb)
        from (
          select m.key, sum(m.value::int) as total
          from public.message_fragments f2, jsonb_each_text(f2.visitor_reactions) m
          where f2.cluster_id = base.id and f2.deleted_at is null
          group by m.key
        ) e
      ) as visitor_reactions,
      sum(f.reactions_count)::int as reactions_count,
      sum(f.comments_count)::int as comments_count
    from public.message_fragments f
    where f.cluster_id = base.id and f.deleted_at is null
  ) s on true
  left join lateral (
    -- Голос удалённого аккаунта — отдельный человек, как в модели.
    select (count(distinct x.user_id) + count(*) filter (where x.user_id is null))::int as people
    from public.message_fragments f3
    cross join lateral (
      select r.user_id
      from public.reactions r
      where r.target_type = 'fragment' and r.target_id = f3.id and r.deleted_at is null
      union all
      select c.author_id
      from public.comments c
      where c.fragment_id = f3.id and c.deleted_at is null
    ) x
    where f3.cluster_id = base.id and f3.deleted_at is null
  ) p on true
  where k.id = base.id
    and base.message_id = target_message
    and base.deleted_at is null;
end;
$$;


-- =============================================================================
-- 2. Заявка от обработчика
-- =============================================================================

grant execute on function public.fragment_clusters_enqueue(uuid) to service_role;

-- =============================================================================
-- 3. Диапазоны кластеров после правки
-- =============================================================================

-- Та же функция, что в 20261023120000_fragment_plans_truncate.sql, плюс
-- диапазоны кластеров по оставшимся фрагментам.
create or replace function public.rebind_message_fragments()
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
  plan record;
begin
  perform public.lock_fragment_clusters_shared(new.id);
  -- Фрагменты переезжают пачкой: счётчики кластеров — один раз в конце.
  perform set_config('open.clusters_writer', 'on', true);

  create temp table if not exists fragment_rebind_plan (
    id uuid primary key,
    author_id uuid,
    created_at timestamptz,
    old_start int,
    old_state text,
    new_start int,
    new_end int
  ) on commit drop;

  create temp table if not exists fragment_rebind_clusters (
    id uuid primary key,
    cluster_id uuid
  ) on commit drop;

  truncate fragment_rebind_plan, fragment_rebind_clusters;

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

    insert into fragment_rebind_plan values (
      f.id,
      f.author_id,
      f.created_at,
      f.start_offset,
      f.anchor_state,
      case when best_start is null or tie then null else best_start end,
      case when best_start is null or tie then null else best_start + piece_len end
    );

    insert into fragment_rebind_clusters values (f.id, f.cluster_id);
  end loop;

  -- Двое одного автора на одном новом месте — место за старшим.
  update fragment_rebind_plan p
  set new_start = null, new_end = null
  where p.new_start is not null
    and p.author_id is not null
    and exists (
      select 1 from fragment_rebind_plan o
      where o.id <> p.id
        and o.author_id = p.author_id
        and o.new_start = p.new_start
        and o.new_end = p.new_end
        and (o.created_at, o.id) < (p.created_at, p.id)
    );

  update public.message_fragments mf
  set anchor_state = 'lost'
  from fragment_rebind_plan p
  where mf.id = p.id;

  for plan in
    select p.*, c.cluster_id
    from fragment_rebind_plan p
    join fragment_rebind_clusters c on c.id = p.id
  loop
    if plan.new_start is null then
      update public.message_fragments
      set prefix_text = '', suffix_text = ''
      where id = plan.id;
    else
      update public.message_fragments
      set
        anchor_state = case when plan.new_start = plan.old_start then plan.old_state else 'shifted' end,
        start_offset = plan.new_start,
        end_offset = plan.new_end,
        prefix_text = substr(body, greatest(1, plan.new_start - context + 1), least(plan.new_start, context)),
        suffix_text = substr(body, plan.new_end + 1, context),
        cluster_id = plan.cluster_id
      where id = plan.id;
    end if;
  end loop;

  -- Диапазоны кластеров — от прежнего текста. До пересчёта кластер стоит на
  -- оставшихся в нём фрагментах: новый фрагмент не войдёт в него по старому
  -- месту. Кластер без фрагментов гаснет.
  update public.fragment_clusters k
  set start_offset = h.start_offset, end_offset = h.end_offset, updated_at = now()
  from (
    select mf.cluster_id, min(mf.start_offset) as start_offset, max(mf.end_offset) as end_offset
    from public.message_fragments mf
    where mf.message_id = new.id and mf.cluster_id is not null
    group by mf.cluster_id
  ) h
  where k.id = h.cluster_id;

  update public.fragment_clusters k
  set deleted_at = now(), display_start = null, display_end = null, updated_at = now()
  where k.message_id = new.id
    and k.deleted_at is null
    and not exists (select 1 from public.message_fragments mf where mf.cluster_id = k.id);

  update public.fragment_clusters
  set display_start = null, display_end = null, updated_at = now()
  where message_id = new.id and deleted_at is null and display_start is not null;

  perform public.refresh_message_clusters(new.id);
  perform set_config('open.clusters_writer', '', true);

  if exists (select 1 from fragment_rebind_plan) then
    perform public.fragment_clusters_touch(new.id, false, true);
  end if;

  return null;
end;
$$;


-- =============================================================================
-- 4. Один обработчик за раз
-- =============================================================================

/** Последний вызов обработчика: запрос pg_net и когда. Одна строка. */
create table public.fragment_cluster_worker (
  id uuid not null default gen_random_uuid () unique,
  singleton boolean primary key default true check (singleton),
  request_id bigint not null,
  kicked_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.fragment_cluster_worker enable row level security;
revoke all on public.fragment_cluster_worker from anon, authenticated;

-- Та же функция, что в 20261023100000_fragment_clusters.sql, но пока
-- работает прошлый вызов, новый не идёт.
create or replace function public.fragment_clusters_kick()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  url text;
  secret text;
begin
  if not exists (select 1 from pgmq.q_fragment_clusters where vt <= now()) then
    return false;
  end if;

  select decrypted_secret into url from vault.decrypted_secrets where name = 'fragment_clusters_worker_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'fragment_clusters_worker_secret';

  if url is null or secret is null then
    return false;
  end if;

  -- Обработчик ещё работает (его ответ не пришёл, и он не старше своего
  -- бюджета) — он сам доберёт новые заявки: второй не нужен.
  if exists (
    select 1
    from public.fragment_cluster_worker w
    where w.kicked_at > now() - interval '25 seconds'
      and not exists (select 1 from net._http_response r where r.id = w.request_id)
  ) then
    return false;
  end if;

  insert into public.fragment_cluster_worker as w (singleton, request_id, kicked_at)
  values (
    true,
    net.http_post(
      url := url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    ),
    now()
  )
  on conflict (singleton) do update set request_id = excluded.request_id, kicked_at = excluded.kicked_at;

  return true;
end;
$$;
