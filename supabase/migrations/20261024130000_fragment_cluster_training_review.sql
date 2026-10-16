-- Кластеры фрагментов: журнал решений и события, доработка по ревью.
--
-- 1. Периодический снимок решения (раз в `decisionEvery` пересчётов при том же
--    наборе) не переставляет `decision_id` у кластеров: клиент не получает
--    сигнала об этом и слал бы события по старому id. Кластеры ссылаются на
--    снимок, по которому показан нынешний набор.
-- 2. Лимит частоты событий считает только события клиента: серверные
--    `fragment_created` — реакции и комментарии самого человека.
-- 3. Диапазон события вне int обнуляется, а не роняет всю пачку.
-- 4. Место нового фрагмента — одним проходом по кластерам сообщения.
-- 5. Очистка журнала не держит снимки погасших кластеров.

-- Та же функция, что в 20261024100000_fragment_cluster_decisions.sql, но
-- периодический снимок не подменяет снимок показанного набора.
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
  decision_now uuid;
  shown_decision uuid;
  shown_changed boolean;
  skipped int;
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('open.clusters_writer', 'on', true);
  perform pg_advisory_xact_lock(public.fragment_clusters_lock_key(target_message));

  select * into st from public.fragment_cluster_state where message_id = target_message;

  if st.lease_token is null or st.lease_token::text is distinct from result ->> 'lease' then
    perform pgmq.delete('fragment_clusters', ids);
    return 'lease_lost';
  end if;

  decision_now := st.decision_id;
  skipped := st.decisions_skipped;

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

  -- Снимок решения: при смене отображаемого набора или раз в `decisionEvery`
  -- пересчётов — иначе журнал заполнили бы одинаковые снимки.
  if outcome = 'applied' and jsonb_typeof(result -> 'decision') = 'object' then
    shown_changed := decision_now is null or before_display is distinct from after_display;

    if shown_changed or skipped + 1 >= greatest(1, coalesce((cfg.params ->> 'decisionEvery')::int, 20)) then
      insert into public.fragment_cluster_decisions (message_id, model_version, scorer, interactions, decision, displayed)
      values (
        target_message,
        result_version,
        result -> 'decision' ->> 'scorer',
        coalesce((result ->> 'interactions')::int, 0),
        result -> 'decision',
        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'cluster_id', k.id, 'start', k.display_start, 'end', k.display_end
          ) order by k.display_start), '[]'::jsonb)
          from public.fragment_clusters k
          where k.message_id = target_message and k.deleted_at is null and k.display_start is not null
        )
      )
      returning id into decision_now;

      skipped := 0;
    else
      skipped := skipped + 1;
    end if;

    -- Кластеры ссылаются на снимок, по которому показан нынешний набор.
    -- Периодический снимок с тем же набором его не подменяет: клиент о нём не
    -- узнал бы (сигнала нет — набор тот же) и слал бы события по старому id.
    if shown_changed then
      shown_decision := decision_now;
    else
      select k.decision_id into shown_decision
      from public.fragment_clusters k
      where k.message_id = target_message
        and k.deleted_at is null
        and k.display_start is not null
        and k.decision_id is not null
      limit 1;

      shown_decision := coalesce(shown_decision, decision_now);
    end if;

    update public.fragment_clusters k
    set decision_id = shown_decision
    where k.message_id = target_message
      and k.deleted_at is null
      and k.decision_id is distinct from shown_decision;
  end if;

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
    decision_id = decision_now,
    decisions_skipped = skipped,
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

-- Та же функция, что в 20261024120000_fragment_cluster_events.sql, но лимит
-- частоты — без серверных событий, диапазон вне int обнуляется.
create or replace function public.record_fragment_cluster_events(events jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  cfg jsonb := (public.fragment_cluster_settings()).params;
  batch_max int := greatest(1, coalesce((cfg ->> 'eventsBatchMax')::int, 50));
  per_minute int := greatest(1, coalesce((cfg ->> 'eventsPerMinute')::int, 300));
  dedup int := greatest(0, coalesce((cfg ->> 'shownDedupSeconds')::int, 30));
  n int;
  recent int;
  e jsonb;
  kind_ text;
  msg public.messages;
  decision uuid;
  cluster uuid;
  fragment uuid;
  rs int;
  re int;
  info jsonb;
  written int := 0;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if events is null or jsonb_typeof(events) <> 'array' then
    raise exception 'events must be an array' using errcode = '22023';
  end if;

  n := jsonb_array_length(events);

  if n = 0 then
    return 0;
  end if;

  if n > batch_max then
    raise exception 'too many events in one batch' using errcode = '22023';
  end if;

  -- Две пачки одного человека разом — по очереди: лимит частоты не обойти.
  perform pg_advisory_xact_lock(hashtextextended('fragment_cluster_events:' || caller::text, 0));

  -- Серверные события (реакции и комментарии самого человека) в лимит не идут.
  select count(*) into recent
  from public.fragment_cluster_events
  where user_id = caller and created_at > now() - interval '1 minute' and kind <> 'fragment_created';

  if recent + n > per_minute then
    raise exception 'too many events' using errcode = '22023';
  end if;

  for e in select value from jsonb_array_elements(events) loop
    kind_ := e ->> 'kind';

    if kind_ is null or kind_ not in (
      'clusters_shown', 'cluster_opened', 'cluster_reacted', 'cluster_commented', 'area_opened', 'quote_followed'
    ) then
      raise exception 'unknown event kind' using errcode = '22023';
    end if;

    select * into msg from public.messages where id = public.uuid_or_null(e ->> 'message_id');

    if msg.id is null or msg.deleted_at is not null then
      continue;
    end if;

    select d.id into decision
    from public.fragment_cluster_decisions d
    where d.id = public.uuid_or_null(e ->> 'decision_id') and d.message_id = msg.id;

    select k.id into cluster
    from public.fragment_clusters k
    where k.id = public.uuid_or_null(e ->> 'cluster_id') and k.message_id = msg.id;

    select f.id into fragment
    from public.message_fragments f
    where f.id = public.uuid_or_null(e ->> 'fragment_id') and f.message_id = msg.id;

    -- Число вне int — не диапазон: обнуляется, пачка не падает.
    rs := case
      when jsonb_typeof(e -> 'range_start') = 'number' and (e ->> 'range_start')::numeric between 0 and 2147483647
        then (e ->> 'range_start')::numeric::int
    end;
    re := case
      when jsonb_typeof(e -> 'range_end') = 'number' and (e ->> 'range_end')::numeric between 0 and 2147483647
        then (e ->> 'range_end')::numeric::int
    end;

    if rs is null or re is null or rs < 0 or re <= rs or re > char_length(coalesce(msg.text, '')) then
      rs := null;
      re := null;
    end if;

    info := case
      when jsonb_typeof(e -> 'detail') = 'object' and length((e -> 'detail')::text) <= 1000 then e -> 'detail'
      else '{}'::jsonb
    end;

    if kind_ = 'clusters_shown' and exists (
      select 1
      from public.fragment_cluster_events x
      where x.user_id = caller
        and x.kind = 'clusters_shown'
        and x.message_id = msg.id
        and x.decision_id is not distinct from decision
        and x.created_at > now() - make_interval(secs => dedup)
    ) then
      continue;
    end if;

    insert into public.fragment_cluster_events (
      user_id, message_id, decision_id, cluster_id, fragment_id, kind, range_start, range_end, detail
    ) values (caller, msg.id, decision, cluster, fragment, kind_, rs, re, info);

    written := written + 1;
  end loop;

  return written;
end;
$$;

-- Та же функция, что в 20261024120000_fragment_cluster_events.sql, но одним
-- проходом по кластерам.
create or replace function public.log_fragment_created(fragment uuid, actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.message_fragments;
  best record;
  decision uuid;
begin
  select * into f from public.message_fragments where id = fragment;

  if f.id is null then
    return;
  end if;

  select
    k.id,
    k.decision_id,
    k.display_start,
    k.display_end,
    least(k.display_end, f.end_offset) - greatest(k.display_start, f.start_offset) as overlap,
    count(*) over () as shown
  into best
  from public.fragment_clusters k
  where k.message_id = f.message_id
    and k.deleted_at is null
    and k.display_start is not null
  order by
    least(k.display_end, f.end_offset) - greatest(k.display_start, f.start_offset) desc,
    k.display_start
  limit 1;

  decision := coalesce(
    best.decision_id,
    (select s.decision_id from public.fragment_cluster_state s where s.message_id = f.message_id)
  );

  insert into public.fragment_cluster_events (
    user_id, message_id, decision_id, cluster_id, fragment_id, kind, range_start, range_end, placement, detail
  ) values (
    actor,
    f.message_id,
    decision,
    case when best.overlap > 0 then best.id end,
    f.id,
    'fragment_created',
    f.start_offset,
    f.end_offset,
    case
      when best.id is null or best.overlap <= 0 then 'outside'
      when f.start_offset >= best.display_start and f.end_offset <= best.display_end then 'inside'
      else 'partial'
    end,
    jsonb_build_object(
      'overlap', greatest(coalesce(best.overlap, 0), 0),
      'length', f.end_offset - f.start_offset,
      'shown', coalesce(best.shown, 0)
    )
  );
end;
$$;

-- Та же функция, что в 20261024120000_fragment_cluster_events.sql, но снимок
-- держат только живые кластеры.
create or replace function public.fragment_cluster_history_cleanup()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  days int := greatest(1, coalesce(((public.fragment_cluster_settings()).params ->> 'historyRetentionDays')::int, 180));
  removed int;
  events_removed int;
begin
  delete from public.fragment_cluster_events e
  where e.created_at < now() - make_interval(days => days);

  get diagnostics events_removed = row_count;

  delete from public.fragment_cluster_decisions d
  where d.created_at < now() - make_interval(days => days)
    and not exists (select 1 from public.fragment_clusters k where k.decision_id = d.id and k.deleted_at is null)
    and not exists (select 1 from public.fragment_cluster_state s where s.decision_id = d.id);

  get diagnostics removed = row_count;

  return removed + events_removed;
end;
$$;
