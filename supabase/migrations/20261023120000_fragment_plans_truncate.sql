-- Запросы через PostgREST идут с pg-safeupdate: DELETE без WHERE там
-- запрещён — и внутри функций тоже. Временные таблицы планов очищаются
-- TRUNCATE. Задевало и перепривязку фрагментов при правке текста (этап 1):
-- правка сообщения с фрагментами из приложения падала «DELETE requires a
-- WHERE clause»; тесты через `db query` этого не видели.

-- Та же функция, что в 20261023100000_fragment_clusters.sql, но планы
-- очищаются TRUNCATE.
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


-- Та же функция, что в 20261023100000_fragment_clusters.sql, но планы
-- очищаются TRUNCATE.
create or replace function public.fragment_clusters_apply(target_message uuid, result jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  st public.fragment_cluster_state;
  m public.messages;
  cfg public.fragment_cluster_config := public.fragment_cluster_settings();
  ids bigint[] := array(select jsonb_array_elements_text(coalesce(result -> 'msg_ids', '[]'::jsonb))::bigint);
  result_version int := coalesce((result ->> 'model_version')::int, cfg.version);
  before_display text;
  after_display text;
  unattached int;
  outcome text := 'applied';
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('open.clusters_writer', 'on', true);
  perform pg_advisory_xact_lock(public.fragment_clusters_lock_key(target_message));

  select * into st from public.fragment_cluster_state where message_id = target_message;

  if st.lease_token is null or st.lease_token::text is distinct from result ->> 'lease' then
    perform pgmq.delete('fragment_clusters', ids);
    return 'lease_lost';
  end if;

  select * into m from public.messages where id = target_message;

  select string_agg(k.id || ':' || k.display_start || '-' || k.display_end, ',' order by k.id)
  into before_display
  from public.fragment_clusters k
  where k.message_id = target_message and k.deleted_at is null and k.display_start is not null;

  if m.id is null or m.deleted_at is not null then
    update public.message_fragments set cluster_id = null
    where message_id = target_message and cluster_id is not null;

    update public.fragment_clusters
    set deleted_at = now(), display_start = null, display_end = null, updated_at = now()
    where message_id = target_message and deleted_at is null;

    outcome := 'deleted';
  elsif coalesce(m.edited_at, m.created_at) is distinct from (result ->> 'text_version')::timestamptz
     or md5(coalesce(m.text, '')) is distinct from result ->> 'text_hash' then
    update public.fragment_cluster_state
    set lease_token = null, lease_until = null, updated_at = now()
    where message_id = target_message;

    perform public.fragment_clusters_enqueue(target_message);
    perform pgmq.delete('fragment_clusters', ids);

    return 'stale_text';
  else
    -- Строки фрагментов — первыми и по порядку: так же их берут реакции.
    perform 1 from public.message_fragments
    where message_id = target_message
    order by id
    for no key update;

    create temp table if not exists fragment_cluster_plan (
      ord int primary key,
      id uuid not null,
      inherited boolean not null,
      start_offset int not null,
      end_offset int not null,
      display_start int,
      display_end int,
      popularity double precision not null
    ) on commit drop;

    create temp table if not exists fragment_cluster_assign (
      fragment_id uuid primary key,
      ord int not null
    ) on commit drop;

    truncate fragment_cluster_plan, fragment_cluster_assign;

    insert into fragment_cluster_plan
    select
      c.ord,
      case when c.dup = 1 and k.id is not null then k.id else gen_random_uuid() end,
      c.dup = 1 and k.id is not null,
      c.start_offset,
      c.end_offset,
      c.display_start,
      c.display_end,
      c.popularity
    from (
      select
        x.ord::int as ord,
        public.uuid_or_null(x.v ->> 'id') as wanted,
        (x.v ->> 'start')::int as start_offset,
        (x.v ->> 'end')::int as end_offset,
        (x.v -> 'display' ->> 'start')::int as display_start,
        (x.v -> 'display' ->> 'end')::int as display_end,
        coalesce((x.v ->> 'popularity')::double precision, 0) as popularity,
        row_number() over (partition by public.uuid_or_null(x.v ->> 'id') order by x.ord) as dup
      from jsonb_array_elements(coalesce(result -> 'clusters', '[]'::jsonb)) with ordinality as x(v, ord)
    ) c
    left join public.fragment_clusters k
      on k.id = c.wanted and k.message_id = target_message and k.deleted_at is null;

    insert into fragment_cluster_assign (fragment_id, ord)
    select distinct on (public.uuid_or_null(f.value)) public.uuid_or_null(f.value), x.ord::int
    from jsonb_array_elements(coalesce(result -> 'clusters', '[]'::jsonb)) with ordinality as x(v, ord)
    cross join lateral jsonb_array_elements_text(coalesce(x.v -> 'fragmentIds', '[]'::jsonb)) f(value)
    where public.uuid_or_null(f.value) is not null
    order by public.uuid_or_null(f.value), x.ord;

    update public.fragment_clusters k
    set
      start_offset = p.start_offset,
      end_offset = p.end_offset,
      display_start = p.display_start,
      display_end = p.display_end,
      popularity = p.popularity,
      model_version = result_version,
      updated_at = now()
    from fragment_cluster_plan p
    where p.inherited and k.id = p.id;

    insert into public.fragment_clusters (
      id, message_id, chat_id, start_offset, end_offset, display_start, display_end, popularity, model_version
    )
    select p.id, m.id, m.chat_id, p.start_offset, p.end_offset, p.display_start, p.display_end, p.popularity, result_version
    from fragment_cluster_plan p
    where not p.inherited;

    update public.fragment_clusters k
    set deleted_at = now(), display_start = null, display_end = null, updated_at = now()
    where k.message_id = target_message
      and k.deleted_at is null
      and not exists (select 1 from fragment_cluster_plan p where p.id = k.id);

    -- Фрагменты из результата — в свои кластеры.
    update public.message_fragments f
    set cluster_id = p.id
    from fragment_cluster_assign a
    join fragment_cluster_plan p on p.ord = a.ord
    where f.id = a.fragment_id
      and f.message_id = target_message
      and f.deleted_at is null
      and f.anchor_state <> 'lost'
      and f.cluster_id is distinct from p.id;

    -- Появившиеся после снимка (и все, чей кластер погас) — по правилу
    -- нового фрагмента: в кластер с наибольшим пересечением или без кластера.
    update public.message_fragments f
    set cluster_id = (
      select k.id
      from public.fragment_clusters k
      where k.message_id = target_message
        and k.deleted_at is null
        and k.start_offset < f.end_offset
        and k.end_offset > f.start_offset
      order by
        least(k.end_offset, f.end_offset) - greatest(k.start_offset, f.start_offset) desc,
        k.created_at,
        k.id
      limit 1
    )
    where f.message_id = target_message
      and f.deleted_at is null
      and f.anchor_state <> 'lost'
      and not exists (select 1 from fragment_cluster_assign a where a.fragment_id = f.id);

    -- Спящие и потерянные не держат погасших кластеров.
    update public.message_fragments f
    set cluster_id = null
    from public.fragment_clusters k
    where f.message_id = target_message
      and f.cluster_id = k.id
      and k.deleted_at is not null;

    perform public.refresh_message_clusters(target_message);
  end if;

  select string_agg(k.id || ':' || k.display_start || '-' || k.display_end, ',' order by k.id)
  into after_display
  from public.fragment_clusters k
  where k.message_id = target_message and k.deleted_at is null and k.display_start is not null;

  select count(*) into unattached
  from public.message_fragments f
  where f.message_id = target_message
    and f.deleted_at is null
    and f.anchor_state <> 'lost'
    and f.cluster_id is null;

  update public.fragment_cluster_state
  set
    lease_token = null,
    lease_until = null,
    recomputed_interactions = coalesce((result ->> 'interactions')::int, recomputed_interactions),
    model_version = result_version,
    recomputed_at = now(),
    updated_at = now()
  where message_id = target_message
  returning * into st;

  perform pgmq.delete('fragment_clusters', ids);

  -- Снимок сильно устарел или кто-то остался без кластера — ещё раз.
  if outcome = 'applied' and (
    unattached > 0
    or st.interactions - st.recomputed_interactions >= coalesce((cfg.params ->> 'staleInteractions')::int, 10)
  ) then
    perform public.fragment_clusters_enqueue(target_message);
  end if;

  if before_display is distinct from after_display and m.id is not null then
    begin
      perform realtime.send(
        jsonb_build_object('chat_id', m.chat_id, 'message_id', target_message),
        'clusters_changed',
        'chat:' || m.chat_id::text,
        true
      );
    exception
      when others then null;
    end;
  end if;

  return outcome;
end;
$$;
