-- Рекомендации, этап 1: свёртка журнала.
--
-- Раз в минуту (pg_cron) сырьё за окно от водяного знака превращается в:
--   1. строки показов — пересобираются целиком из событий показа, повтор
--      ничего не меняет;
--   2. потерянные показы (нет снимка дольше `lostTimeoutSeconds`) —
--      закрываются с `exit = lost` по последнему снимку;
--   3. вклад закрытого показа в агрегаты попа, почасовые корзины и тепловую
--      карту — разницей с уже внесённым (`applied`), так что пересборка
--      показа (поздний конец после `lost`) не считает его дважды;
--   4. метки показов — пересчитываются целиком из серверных событий человека
--      в окне показа плюс окно опоздания; каждое событие — к последнему
--      показу того же попа (или канала) до него;
--   5. счётчики меток попа — из серверных событий окна, ровно один раз;
--   6. сессии приложения — пересборка затронутых, потерянные закрываются;
--   7. метки старше окна опоздания закрываются — строка готова для обучения.
--
-- Две свёртки одновременно не идут (advisory-блокировка без ожидания).
-- Публикующие в канале в агрегаты своего попа не попадают; аккаунты моложе
-- `newAccountHours` — с весом доверия `newAccountWeight`.

/** Поэлементная сумма `a + sign * b` с выравниванием длины до `n`. */
create function public.rec_int_array_add(a int[], b int[], sign int, n int)
returns int[]
language sql
immutable
as $$
  select coalesce(array_agg(coalesce(a[i], 0) + sign * coalesce(b[i], 0) order by i), '{}')
  from generate_series(1, greatest(n, coalesce(cardinality(a), 0), coalesce(cardinality(b), 0))) i
$$;

revoke execute on function public.rec_int_array_add(int[], int[], int, int) from public, anon, authenticated;

/** Сегмент позиции `pos_ms` (с 1, для индексов массивов). */
create function public.rec_segment_of(pos_ms numeric, segment_ms int, segments int)
returns int
language sql
immutable
as $$
  select least(greatest(floor(greatest(pos_ms, 0) / greatest(segment_ms, 1))::int, 0), greatest(segments, 1) - 1) + 1
$$;

revoke execute on function public.rec_segment_of(numeric, int, int) from public, anon, authenticated;

-- =============================================================================
-- 1. Пересборка показов
-- =============================================================================

create function public.rec_rebuild_impressions(ids uuid[], since timestamptz)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg jsonb := public.rec_settings();
  first_frame_ok int := coalesce((cfg ->> 'normalDeliveryFirstFrameMs')::int, 2000);
  buffering_share numeric := coalesce((cfg ->> 'normalDeliveryBufferingShare')::numeric, 0.1);
  quick_ms int := coalesce((cfg ->> 'quickSkipMs')::int, 2000);
  complete_share numeric := coalesce((cfg ->> 'completionShare')::numeric, 0.9);
  n int;
begin
  if coalesce(cardinality(ids), 0) = 0 then
    return 0;
  end if;

  with st as (
    select distinct on (e.impression_id)
      e.impression_id, e.user_id, e.subject_type, e.subject_id, e.surface, e.app_session_id, e.event_ts, e.data
    from public.rec_events e
    where e.impression_id = any (ids) and e.kind = 'impression_start' and e.server_ts > since
    order by e.impression_id, e.server_ts
  ),
  snap as (
    select distinct on (e.impression_id) e.impression_id, e.kind, e.event_ts, e.data
    from public.rec_events e
    where e.impression_id = any (ids)
      and e.kind in ('impression_progress', 'impression_end')
      and e.server_ts > since
    order by e.impression_id, (e.kind = 'impression_end') desc, e.event_ts desc
  ),
  opened as (
    select e.impression_id
    from public.rec_events e
    where e.impression_id = any (ids) and e.kind = 'channel_opened' and e.server_ts > since
    group by e.impression_id
  ),
  comm as (
    select
      e.impression_id,
      jsonb_strip_nulls(jsonb_build_object(
        'opens', count(*),
        'ms', sum(public.rec_num(e.data, 'ms')),
        'shown', sum(public.rec_num(e.data, 'shown')),
        'max_depth', max(public.rec_num(e.data, 'max_depth')),
        'threads', sum(public.rec_num(e.data, 'threads_expanded')),
        'composer', (array_agg(e.data ->> 'composer' order by e.event_ts desc))[1]
      )) as summary
    from public.rec_events e
    where e.impression_id = any (ids) and e.kind = 'comments_session' and e.server_ts > since
    group by e.impression_id
  ),
  built as (
    select
      st.impression_id as id,
      st.user_id,
      st.subject_type,
      st.subject_id,
      p.channel_id,
      st.app_session_id,
      st.surface,
      public.rec_text(st.data, 'entry') as entry,
      public.uuid_or_null(public.rec_text(st.data, 'request_id')) as request_id,
      public.rec_num(st.data, 'position')::int as position,
      public.rec_text(st.data, 'source') as source,
      public.rec_text(st.data, 'algo_version') as algo_version,
      coalesce(public.can_publish_in_channel(p.channel_id, st.user_id), false) as is_publisher,
      st.event_ts as started_at,
      case when snap.kind = 'impression_end' then snap.event_ts end as ended_at,
      greatest(st.event_ts, coalesce(snap.event_ts, st.event_ts)) as last_seen_at,
      case when snap.kind = 'impression_end' then public.rec_text(snap.data, 'exit') end as exit,
      p.duration_ms,
      coalesce(public.rec_num(snap.data, 'visible_ms'), 0)::int as visible_ms,
      coalesce(public.rec_num(snap.data, 'watch_ms'), 0)::int as watch_ms,
      coalesce(public.rec_num(snap.data, 'max_pos_ms'), 0)::int as max_pos_ms,
      public.rec_segment_ms(p.duration_ms) as segment_ms,
      public.rec_segments(p.duration_ms) as segments,
      coalesce(public.rec_num(snap.data, 'coverage'), 0)::bigint as coverage,
      coalesce(public.rec_num(snap.data, 'loops'), 0)::int as loops,
      coalesce(public.rec_num(snap.data, 'pauses'), 0)::int as pauses,
      coalesce(public.rec_num(snap.data, 'pause_ms'), 0)::int as pause_ms,
      case when jsonb_typeof(snap.data -> 'pause_reasons') = 'object' then snap.data -> 'pause_reasons' else '{}'::jsonb end as pause_reasons,
      case when jsonb_typeof(snap.data -> 'pause_list') = 'array' then snap.data -> 'pause_list' else '[]'::jsonb end as pause_list,
      coalesce(public.rec_num(snap.data, 'seeks_back'), 0)::int as seeks_back,
      coalesce(public.rec_num(snap.data, 'seeks_fwd'), 0)::int as seeks_fwd,
      coalesce(public.rec_num(snap.data, 'seek_back_ms'), 0)::int as seek_back_ms,
      coalesce(public.rec_num(snap.data, 'seek_fwd_ms'), 0)::int as seek_fwd_ms,
      case when jsonb_typeof(snap.data -> 'seeks') = 'array' then snap.data -> 'seeks' else '[]'::jsonb end as seek_list,
      public.rec_num(snap.data, 'first_frame_ms')::int as first_frame_ms,
      coalesce(public.rec_num(snap.data, 'buffering_count'), 0)::int as buffering_count,
      coalesce(public.rec_num(snap.data, 'buffering_ms'), 0)::int as buffering_ms,
      public.rec_text(snap.data, 'error') as error,
      public.rec_num(st.data, 'volume')::real as volume_start,
      public.rec_num(snap.data, 'volume_min')::real as volume_min,
      public.rec_num(snap.data, 'volume_max')::real as volume_max,
      case
        when jsonb_typeof(snap.data -> 'muted') = 'boolean' then (snap.data ->> 'muted')::boolean
        when jsonb_typeof(st.data -> 'muted') = 'boolean' then (st.data ->> 'muted')::boolean
      end as muted,
      coalesce(public.rec_text(snap.data, 'route'), public.rec_text(st.data, 'route')) as audio_route,
      case when jsonb_typeof(snap.data -> 'volume_changes') = 'array' then snap.data -> 'volume_changes' else '[]'::jsonb end as volume_changes,
      case when jsonb_typeof(snap.data -> 'route_changes') = 'array' then snap.data -> 'route_changes' else '[]'::jsonb end as route_changes,
      public.rec_text(st.data, 'network') as network,
      public.rec_text(st.data, 'orientation') as orientation,
      coalesce(comm.summary, '{}'::jsonb) as comments,
      opened.impression_id is not null as channel_opened
    from st
    join public.pops p on p.id = st.subject_id
    left join snap on snap.impression_id = st.impression_id
    left join opened on opened.impression_id = st.impression_id
    left join comm on comm.impression_id = st.impression_id
  ),
  judged as (
    select
      b.*,
      coalesce(bit_count(b.coverage::bit(64))::real / b.segments, 0)::real as coverage_share,
      (b.error is null
        and b.first_frame_ms is not null
        and b.first_frame_ms <= first_frame_ok
        and b.buffering_ms <= buffering_share * greatest(b.visible_ms, 1)) as delivery_ok
    from built b
  )
  insert into public.rec_impressions as i (
    id, user_id, subject_type, subject_id, channel_id, app_session_id, surface, entry, request_id,
    position, source, algo_version, is_publisher, started_at, ended_at, last_seen_at, exit,
    duration_ms, visible_ms, watch_ms, max_pos_ms, segment_ms, segments, coverage, coverage_share,
    loops, pauses, pause_ms, pause_reasons, pause_list, seeks_back, seeks_fwd, seek_back_ms,
    seek_fwd_ms, seek_list, first_frame_ms, buffering_count, buffering_ms, error, delivery_ok,
    volume_start, volume_min, volume_max, muted, audio_route, volume_changes, route_changes,
    network, orientation, comments, completed, quick_skip, channel_opened, rebuilt_at
  )
  select
    j.id, j.user_id, j.subject_type, j.subject_id, j.channel_id, j.app_session_id, j.surface, j.entry,
    j.request_id, j.position, j.source, j.algo_version, j.is_publisher, j.started_at, j.ended_at,
    j.last_seen_at, j.exit, j.duration_ms, j.visible_ms, j.watch_ms, j.max_pos_ms, j.segment_ms,
    j.segments, j.coverage, j.coverage_share, j.loops, j.pauses, j.pause_ms, j.pause_reasons,
    j.pause_list, j.seeks_back, j.seeks_fwd, j.seek_back_ms, j.seek_fwd_ms, j.seek_list,
    j.first_frame_ms, j.buffering_count, j.buffering_ms, j.error, j.delivery_ok, j.volume_start,
    j.volume_min, j.volume_max, j.muted, j.audio_route, j.volume_changes, j.route_changes,
    j.network, j.orientation, j.comments,
    j.coverage_share >= complete_share or j.loops >= 1,
    j.delivery_ok and j.visible_ms < quick_ms and j.exit in ('swipe_next', 'swipe_prev'),
    j.channel_opened,
    now()
  from judged j
  on conflict (id) do update set
    ended_at = excluded.ended_at,
    last_seen_at = excluded.last_seen_at,
    exit = excluded.exit,
    is_publisher = excluded.is_publisher,
    visible_ms = excluded.visible_ms,
    watch_ms = excluded.watch_ms,
    max_pos_ms = excluded.max_pos_ms,
    coverage = excluded.coverage,
    coverage_share = excluded.coverage_share,
    loops = excluded.loops,
    pauses = excluded.pauses,
    pause_ms = excluded.pause_ms,
    pause_reasons = excluded.pause_reasons,
    pause_list = excluded.pause_list,
    seeks_back = excluded.seeks_back,
    seeks_fwd = excluded.seeks_fwd,
    seek_back_ms = excluded.seek_back_ms,
    seek_fwd_ms = excluded.seek_fwd_ms,
    seek_list = excluded.seek_list,
    first_frame_ms = excluded.first_frame_ms,
    buffering_count = excluded.buffering_count,
    buffering_ms = excluded.buffering_ms,
    error = excluded.error,
    delivery_ok = excluded.delivery_ok,
    volume_min = excluded.volume_min,
    volume_max = excluded.volume_max,
    muted = excluded.muted,
    audio_route = excluded.audio_route,
    volume_changes = excluded.volume_changes,
    route_changes = excluded.route_changes,
    comments = excluded.comments,
    completed = excluded.completed,
    quick_skip = excluded.quick_skip,
    channel_opened = excluded.channel_opened,
    rebuilt_at = excluded.rebuilt_at
  -- Строка, у которой ничего не поменялось, не пересобирается: иначе
  -- повторная свёртка двигала бы `rebuilt_at` и вклад в агрегаты.
  where (i.ended_at, i.last_seen_at, i.exit, i.watch_ms, i.visible_ms, i.coverage, i.loops, i.pauses,
         i.seeks_back, i.seeks_fwd, i.buffering_ms, i.comments, i.channel_opened, i.seek_list, i.pause_list)
    is distinct from
        (excluded.ended_at, excluded.last_seen_at, excluded.exit, excluded.watch_ms, excluded.visible_ms,
         excluded.coverage, excluded.loops, excluded.pauses, excluded.seeks_back, excluded.seeks_fwd,
         excluded.buffering_ms, excluded.comments, excluded.channel_opened, excluded.seek_list, excluded.pause_list);

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.rec_rebuild_impressions(uuid[], timestamptz) from public, anon, authenticated;

-- =============================================================================
-- 3. Вклад показа в агрегаты попа
-- =============================================================================

/** Тепловая карта одного показа: просмотренные сегменты, перемотки, паузы. */
create function public.rec_impression_heat(i public.rec_impressions)
returns jsonb
language plpgsql
immutable
as $$
declare
  n int := greatest(coalesce(i.segments, 1), 1);
  views int[] := array_fill(0, array[n]);
  back_into int[] := array_fill(0, array[n]);
  fwd_from int[] := array_fill(0, array[n]);
  pauses int[] := array_fill(0, array[n]);
  item jsonb;
  s int;
  f numeric;
  t numeric;
begin
  for k in 0 .. n - 1 loop
    if (i.coverage >> k) & 1 = 1 then
      views[k + 1] := 1;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(i.seek_list) loop
    f := public.rec_num(item, 'from');
    t := public.rec_num(item, 'to');
    continue when f is null or t is null or f = t;

    if t < f then
      s := public.rec_segment_of(t, i.segment_ms, n);
      back_into[s] := back_into[s] + 1;
    else
      s := public.rec_segment_of(f, i.segment_ms, n);
      fwd_from[s] := fwd_from[s] + 1;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(i.pause_list) loop
    continue when public.rec_num(item, 'at') is null;
    s := public.rec_segment_of(public.rec_num(item, 'at'), i.segment_ms, n);
    pauses[s] := pauses[s] + 1;
  end loop;

  return jsonb_build_object(
    'views', to_jsonb(views),
    'back', to_jsonb(back_into),
    'fwd', to_jsonb(fwd_from),
    'pauses', to_jsonb(pauses)
  );
end;
$$;

revoke execute on function public.rec_impression_heat(public.rec_impressions) from public, anon, authenticated;

create function public.rec_json_ints(j jsonb)
returns int[]
language sql
immutable
as $$
  select coalesce(array_agg(value::int order by ord), '{}')
  from jsonb_array_elements_text(coalesce(j, '[]'::jsonb)) with ordinality as t (value, ord)
$$;

revoke execute on function public.rec_json_ints(jsonb) from public, anon, authenticated;

create function public.rec_apply_impressions(max_rows int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg jsonb := public.rec_settings();
  unique_window interval := make_interval(mins => coalesce((cfg ->> 'uniqueWindowMinutes')::int, 60));
  young interval := make_interval(hours => coalesce((cfg ->> 'newAccountHours')::int, 24));
  young_weight numeric := coalesce((cfg ->> 'newAccountWeight')::numeric, 0.25);
  i public.rec_impressions;
  prev jsonb;
  c jsonb;
  viewer public.rec_pop_viewers;
  counted boolean;
  viewer_new boolean;
  weight numeric;
  heat jsonb;
  prev_heat jsonb;
  done int := 0;
begin
  for i in
    select *
    from public.rec_impressions x
    where x.ended_at is not null and (x.applied_at is null or x.applied_at < x.rebuilt_at)
    order by x.rebuilt_at
    limit max_rows
    for update skip locked
  loop
    done := done + 1;

    if i.is_publisher or i.user_id is null or i.subject_type <> 'pop'
       or not exists (select 1 from public.pops p where p.id = i.subject_id) then
      update public.rec_impressions set applied = coalesce(applied, '{}'::jsonb), applied_at = now() where id = i.id;
      continue;
    end if;

    prev := i.applied;

    -- Уникальность и вес решаются один раз — при первом внесении.
    if prev is null then
      select * into viewer from public.rec_pop_viewers v where v.pop_id = i.subject_id and v.user_id = i.user_id for update;

      viewer_new := viewer.id is null;
      counted := viewer.id is null or viewer.last_counted_at <= i.started_at - unique_window;

      if viewer_new then
        insert into public.rec_pop_viewers (pop_id, user_id, first_at, last_counted_at)
        values (i.subject_id, i.user_id, i.started_at, i.started_at);
      elsif counted then
        update public.rec_pop_viewers set last_counted_at = i.started_at where id = viewer.id;
      end if;

      weight := case
        when (select pr.created_at from public.profiles pr where pr.id = i.user_id) > i.started_at - young then young_weight
        else 1
      end;

      prev := jsonb_build_object('counted', counted, 'viewer', viewer_new, 'weight', weight);
    end if;

    heat := public.rec_impression_heat(i);
    prev_heat := coalesce(i.applied -> 'heat', '{}'::jsonb);

    c := jsonb_build_object(
      'counted', prev -> 'counted',
      'viewer', prev -> 'viewer',
      'weight', prev -> 'weight',
      'raw', 1,
      'impressions', case when (prev ->> 'counted')::boolean then 1 else 0 end,
      'viewers', case when (prev ->> 'viewer')::boolean then 1 else 0 end,
      'watch_ms', i.watch_ms,
      'completions', i.completed::int,
      'quick_skips', i.quick_skip::int,
      'loops', i.loops,
      'delivery_bad', (not coalesce(i.delivery_ok, false))::int,
      'channel_opens', i.channel_opened::int,
      'heat', heat
    );

    insert into public.rec_pop_stats as s (pop_id) values (i.subject_id) on conflict (pop_id) do nothing;

    update public.rec_pop_stats s set
      impressions_raw = s.impressions_raw + 1 - coalesce((i.applied ->> 'raw')::int, 0),
      impressions = s.impressions + (c ->> 'impressions')::int - coalesce((i.applied ->> 'impressions')::int, 0),
      viewers = s.viewers + (c ->> 'viewers')::int - coalesce((i.applied ->> 'viewers')::int, 0),
      viewers_weighted = s.viewers_weighted
        + ((c ->> 'viewers')::int - coalesce((i.applied ->> 'viewers')::int, 0)) * (c ->> 'weight')::real,
      watch_ms = s.watch_ms + i.watch_ms - coalesce((i.applied ->> 'watch_ms')::int, 0),
      completions = s.completions + (c ->> 'completions')::int - coalesce((i.applied ->> 'completions')::int, 0),
      quick_skips = s.quick_skips + (c ->> 'quick_skips')::int - coalesce((i.applied ->> 'quick_skips')::int, 0),
      loops = s.loops + i.loops - coalesce((i.applied ->> 'loops')::int, 0),
      delivery_bad = s.delivery_bad + (c ->> 'delivery_bad')::int - coalesce((i.applied ->> 'delivery_bad')::int, 0),
      channel_opens = s.channel_opens + (c ->> 'channel_opens')::int - coalesce((i.applied ->> 'channel_opens')::int, 0),
      updated_at = now()
    where s.pop_id = i.subject_id;

    insert into public.rec_pop_hourly as h (pop_id, hour, impressions, viewers, watch_ms, completions, quick_skips)
    values (
      i.subject_id,
      date_trunc('hour', i.started_at),
      (c ->> 'impressions')::int - coalesce((i.applied ->> 'impressions')::int, 0),
      (c ->> 'viewers')::int - coalesce((i.applied ->> 'viewers')::int, 0),
      i.watch_ms - coalesce((i.applied ->> 'watch_ms')::int, 0),
      (c ->> 'completions')::int - coalesce((i.applied ->> 'completions')::int, 0),
      (c ->> 'quick_skips')::int - coalesce((i.applied ->> 'quick_skips')::int, 0)
    )
    on conflict (pop_id, hour) do update set
      impressions = h.impressions + excluded.impressions,
      viewers = h.viewers + excluded.viewers,
      watch_ms = h.watch_ms + excluded.watch_ms,
      completions = h.completions + excluded.completions,
      quick_skips = h.quick_skips + excluded.quick_skips;

    insert into public.rec_pop_heat as h (pop_id, segment_ms, views, seeks_back_into, seeks_fwd_from, pauses)
    values (i.subject_id, i.segment_ms, '{}', '{}', '{}', '{}')
    on conflict (pop_id) do nothing;

    update public.rec_pop_heat h set
      views = public.rec_int_array_add(
        public.rec_int_array_add(h.views, public.rec_json_ints(heat -> 'views'), 1, i.segments),
        public.rec_json_ints(prev_heat -> 'views'), -1, i.segments),
      seeks_back_into = public.rec_int_array_add(
        public.rec_int_array_add(h.seeks_back_into, public.rec_json_ints(heat -> 'back'), 1, i.segments),
        public.rec_json_ints(prev_heat -> 'back'), -1, i.segments),
      seeks_fwd_from = public.rec_int_array_add(
        public.rec_int_array_add(h.seeks_fwd_from, public.rec_json_ints(heat -> 'fwd'), 1, i.segments),
        public.rec_json_ints(prev_heat -> 'fwd'), -1, i.segments),
      pauses = public.rec_int_array_add(
        public.rec_int_array_add(h.pauses, public.rec_json_ints(heat -> 'pauses'), 1, i.segments),
        public.rec_json_ints(prev_heat -> 'pauses'), -1, i.segments),
      updated_at = now()
    where h.pop_id = i.subject_id;

    update public.rec_impressions set applied = c, applied_at = now() where id = i.id;
  end loop;

  return done;
end;
$$;

revoke execute on function public.rec_apply_impressions(int) from public, anon, authenticated;

-- =============================================================================
-- 4. Метки показа
-- =============================================================================

/**
 * Серверные события меток человека с их показом-владельцем: последний показ
 * того же попа (событие о канале — любого попа канала), начатый до события,
 * у которого событие не позже конца плюс окно опоздания.
 */
create function public.rec_label_events(person uuid, since timestamptz, until timestamptz, late interval)
returns table (event_id uuid, impression_id uuid, kind text, subject_type text, event_ts timestamptz, data jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, owner.id, e.kind, e.subject_type, e.event_ts, e.data
  from public.rec_events e
  cross join lateral (
    select i.id
    from public.rec_impressions i
    where i.user_id = person
      and i.started_at <= e.event_ts
      and e.event_ts <= coalesce(i.ended_at, i.last_seen_at) + late
      and (
        (e.data ? 'pop_id' and i.subject_id = (e.data ->> 'pop_id')::uuid)
        or (e.subject_type = 'pop' and i.subject_id = e.subject_id)
        or (
          not (e.data ? 'pop_id') and e.subject_type <> 'pop'
          and e.data ? 'channel_id' and i.channel_id = (e.data ->> 'channel_id')::uuid
          and e.kind in ('subscribed', 'unsubscribed', 'channel_hidden')
        )
      )
    order by i.started_at desc
    limit 1
  ) owner
  where e.user_id = person
    and e.origin = 'server'
    and e.server_ts >= since
    and e.server_ts <= until
    and e.kind in (
      'reaction_set', 'reaction_removed', 'comment_sent', 'forward_sent', 'subscribed',
      'unsubscribed', 'pop_not_interested', 'channel_hidden'
    )
$$;

revoke execute on function public.rec_label_events(uuid, timestamptz, timestamptz, interval) from public, anon, authenticated;

create function public.rec_relabel(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg jsonb := public.rec_settings();
  late interval := make_interval(hours => coalesce((cfg ->> 'lateWindowHours')::int, 48));
  return_gap interval := make_interval(mins => coalesce((cfg ->> 'returnGapMinutes')::int, 10));
  i public.rec_impressions;
  last_set record;
  last_reaction record;
begin
  select * into i from public.rec_impressions where id = target;

  if i.id is null or i.user_id is null or i.labels_closed_at is not null then
    return;
  end if;

  create temp table if not exists rec_owned (
    event_id uuid, impression_id uuid, kind text, subject_type text, event_ts timestamptz, data jsonb
  ) on commit drop;

  truncate rec_owned;

  insert into rec_owned
  select *
  from public.rec_label_events(
    i.user_id,
    i.started_at - interval '1 minute',
    coalesce(i.ended_at, i.last_seen_at) + late + interval '1 minute',
    late
  ) l
  where l.impression_id = i.id;

  select o.data, o.event_ts into last_set
  from rec_owned o
  where o.kind = 'reaction_set' and o.subject_type = 'pop'
  order by o.event_ts desc
  limit 1;

  select o.kind, o.data into last_reaction
  from rec_owned o
  where o.kind in ('reaction_set', 'reaction_removed') and o.subject_type = 'pop'
  order by o.event_ts desc
  limit 1;

  update public.rec_impressions x set
    reaction_emoji = last_set.data ->> 'emoji',
    reaction_valence = (last_set.data ->> 'valence')::real,
    reaction_at = last_set.event_ts,
    reaction_quick_undo = coalesce(
      last_reaction.kind = 'reaction_removed' and (last_reaction.data ->> 'quick')::boolean, false
    ),
    comments_sent = (select count(*) from rec_owned o where o.kind = 'comment_sent'),
    comment_chars = (select coalesce(sum((o.data ->> 'length')::int), 0) from rec_owned o where o.kind = 'comment_sent'),
    comment_voice = exists (select 1 from rec_owned o where o.kind = 'comment_sent' and o.data ->> 'kind' = 'voice'),
    comment_reply = exists (select 1 from rec_owned o where o.kind = 'comment_sent' and (o.data ->> 'reply')::boolean),
    comment_reactions = (
      select count(*) from rec_owned o where o.kind = 'reaction_set' and o.subject_type = 'comment'
    ),
    forwards = (select count(*) from rec_owned o where o.kind = 'forward_sent'),
    forward_recipients = (
      select count(distinct o.data ->> 'to_chat_id') from rec_owned o where o.kind = 'forward_sent'
    ),
    forward_chat_kinds = coalesce((
      select array_agg(distinct o.data ->> 'to_chat_kind') from rec_owned o
      where o.kind = 'forward_sent' and o.data ? 'to_chat_kind'
    ), '{}'),
    subscribed = exists (select 1 from rec_owned o where o.kind = 'subscribed'),
    unsubscribed = exists (select 1 from rec_owned o where o.kind = 'unsubscribed'),
    not_interested = exists (select 1 from rec_owned o where o.kind = 'pop_not_interested'),
    channel_hidden = exists (select 1 from rec_owned o where o.kind = 'channel_hidden'),
    returned_later = i.ended_at is not null and exists (
      select 1 from public.rec_impressions y
      where y.user_id = i.user_id
        and y.subject_id = i.subject_id
        and y.id <> i.id
        and y.started_at > i.ended_at + return_gap
        and y.started_at <= i.ended_at + late
    )
  where x.id = i.id;
end;
$$;

revoke execute on function public.rec_relabel(uuid) from public, anon, authenticated;

-- =============================================================================
-- 6. Сессии приложения
-- =============================================================================

create function public.rec_rebuild_app_sessions(ids uuid[], since timestamptz)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if coalesce(cardinality(ids), 0) = 0 then
    return 0;
  end if;

  with ev as (
    select e.*
    from public.rec_events e
    where e.app_session_id = any (ids) and e.origin = 'client' and e.server_ts > since
  ),
  agg as (
    select
      ev.app_session_id as id,
      (array_agg(ev.user_id))[1] as user_id,
      coalesce(min(ev.event_ts) filter (where ev.kind = 'app_session_start'), min(ev.event_ts)) as started_at,
      max(ev.event_ts) as last_seen_at,
      (array_agg(ev.kind order by ev.event_ts desc, ev.server_ts desc))[1] as last_kind,
      max(ev.event_ts) filter (where ev.kind in ('app_session_start', 'app_foreground')) as last_fg_start,
      coalesce(sum(public.rec_num(ev.data, 'fg_ms')) filter (where ev.kind = 'app_background'), 0) as fg_closed,
      (array_agg(ev.data ->> 'entry') filter (where ev.kind = 'app_session_start'))[1] as entry,
      (array_agg(ev.data ->> 'platform') filter (where ev.kind = 'app_session_start'))[1] as platform,
      (array_agg(ev.data ->> 'app_version') filter (where ev.kind = 'app_session_start'))[1] as app_version,
      (array_agg(ev.data ->> 'screen' order by ev.event_ts desc) filter (where ev.kind = 'screen_time'))[1] as last_screen,
      count(*) as events,
      count(*) filter (where ev.kind = 'impression_start') as impressions
    from ev
    group by ev.app_session_id
  ),
  tabs as (
    select ev.app_session_id as id, jsonb_object_agg(t.tab, t.ms) as tabs
    from (
      select app_session_id, data ->> 'tab' as tab, sum(public.rec_num(data, 'ms')) as ms
      from ev
      where kind = 'screen_time' and data ? 'tab'
      group by 1, 2
    ) t
    join (select distinct app_session_id from ev) ev on ev.app_session_id = t.app_session_id
    group by ev.app_session_id
  ),
  screens as (
    select s.app_session_id as id, jsonb_object_agg(s.screen, s.ms) as screens
    from (
      select app_session_id, data ->> 'screen' as screen, sum(public.rec_num(data, 'ms')) as ms
      from ev
      where kind = 'screen_time'
      group by 1, 2
    ) s
    group by s.app_session_id
  )
  insert into public.rec_app_sessions as s (
    id, user_id, started_at, ended_at, last_seen_at, foreground_ms, entry, platform, app_version,
    tabs, screens, last_screen, end_reason, events, impressions, rebuilt_at
  )
  select
    a.id,
    a.user_id,
    a.started_at,
    case when a.last_kind = 'app_background' then a.last_seen_at end,
    a.last_seen_at,
    (a.fg_closed + case
      when a.last_kind <> 'app_background' and a.last_fg_start is not null
        then extract(epoch from (a.last_seen_at - a.last_fg_start)) * 1000
      else 0
    end)::bigint,
    a.entry,
    a.platform,
    a.app_version,
    coalesce(t.tabs, '{}'::jsonb),
    coalesce(sc.screens, '{}'::jsonb),
    a.last_screen,
    case when a.last_kind = 'app_background' then 'background' end,
    a.events,
    a.impressions,
    now()
  from agg a
  left join tabs t on t.id = a.id
  left join screens sc on sc.id = a.id
  where exists (select 1 from public.profiles p where p.id = a.user_id)
  on conflict (id) do update set
    started_at = least(s.started_at, excluded.started_at),
    ended_at = excluded.ended_at,
    last_seen_at = excluded.last_seen_at,
    foreground_ms = excluded.foreground_ms,
    entry = coalesce(excluded.entry, s.entry),
    platform = coalesce(excluded.platform, s.platform),
    app_version = coalesce(excluded.app_version, s.app_version),
    tabs = excluded.tabs,
    screens = excluded.screens,
    last_screen = excluded.last_screen,
    end_reason = excluded.end_reason,
    events = excluded.events,
    impressions = excluded.impressions,
    rebuilt_at = excluded.rebuilt_at
  where s.user_id = excluded.user_id;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.rec_rebuild_app_sessions(uuid[], timestamptz) from public, anon, authenticated;

-- =============================================================================
-- Свёртка
-- =============================================================================

/**
 * Один проход свёртки: окно сырья от водяного знака до `upto` (по умолчанию
 * — сейчас минус `rollupLagSeconds`, чтобы не обогнать незакоммиченные
 * пачки; не шире `rollupMaxWindowMinutes` за проход). Отдаёт сводку; занято — `{busy: true}`.
 */
create function public.rec_rollup(upto timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg jsonb := public.rec_settings();
  lag interval := make_interval(secs => coalesce((cfg ->> 'rollupLagSeconds')::int, 10));
  late interval := make_interval(hours => coalesce((cfg ->> 'lateWindowHours')::int, 48));
  lost interval := make_interval(secs => coalesce((cfg ->> 'lostTimeoutSeconds')::int, 90));
  imp_max interval := make_interval(hours => coalesce((cfg ->> 'impressionMaxHours')::int, 12));
  max_age interval := make_interval(hours => greatest(1, coalesce((cfg ->> 'maxEventAgeHours')::int, 72)));
  session_lost interval := make_interval(secs => coalesce((cfg ->> 'appSessionLostSeconds')::int, 1800));
  max_window interval := make_interval(mins => greatest(1, coalesce((cfg ->> 'rollupMaxWindowMinutes')::int, 60)));
  st public.rec_rollup_state;
  wm timestamptz;
  till timestamptz;
  touched uuid[];
  sessions uuid[];
  relabel uuid[];
  rebuilt int;
  lost_n int;
  applied int;
  labeled int := 0;
  sess int;
  closed int;
  counted int;
  id_ uuid;
  summary jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('rec_rollup', 0)) then
    return jsonb_build_object('busy', true);
  end if;

  select * into st from public.rec_rollup_state for update;
  wm := st.watermark;
  till := least(coalesce(upto, now() - lag), wm + max_window);

  if till < wm then
    till := wm;
  end if;

  -- 1. Показы, у которых в окне появились события.
  select coalesce(array_agg(distinct e.impression_id), '{}') into touched
  from public.rec_events e
  where e.server_ts > wm and e.server_ts <= till
    and e.impression_id is not null
    and e.kind in ('impression_start', 'impression_progress', 'impression_end', 'channel_opened', 'comments_session');

  rebuilt := public.rec_rebuild_impressions(touched, wm - imp_max - max_age);

  -- 2. Потерянные показы.
  update public.rec_impressions
  set ended_at = last_seen_at, exit = 'lost', rebuilt_at = now()
  where ended_at is null and last_seen_at < now() - lost;

  get diagnostics lost_n = row_count;

  -- 3. Вклад закрытых показов.
  applied := public.rec_apply_impressions(5000);

  -- 4. Метки: пересобранные показы, прежние показы тех же людей и попов
  -- (вернулся ли позже) и показы, которым в окне пришли серверные события.
  select coalesce(array_agg(distinct x.id), '{}') into relabel
  from (
    select i.id
    from public.rec_impressions i
    where i.id = any (touched) and i.labels_closed_at is null
    union
    select y.id
    from public.rec_impressions i
    join public.rec_impressions y
      on y.user_id = i.user_id and y.subject_id = i.subject_id and y.id <> i.id
    where i.id = any (touched)
      and y.labels_closed_at is null
      and y.started_at > i.started_at - late
    union
    select l.impression_id
    from (
      select distinct e.user_id
      from public.rec_events e
      where e.server_ts > wm and e.server_ts <= till and e.origin = 'server'
    ) u
    cross join lateral public.rec_label_events(u.user_id, wm, till, late) l
    join public.rec_impressions i on i.id = l.impression_id and i.labels_closed_at is null
  ) x;

  foreach id_ in array relabel loop
    perform public.rec_relabel(id_);
    labeled := labeled + 1;
  end loop;

  -- 5. Счётчики меток попа — из событий окна, ровно один раз (водяной знак).
  with ev as (
    select
      e.*,
      coalesce(
        case when e.subject_type = 'pop' then e.subject_id end,
        public.uuid_or_null(e.data ->> 'pop_id')
      ) as pop_id
    from public.rec_events e
    where e.server_ts > wm and e.server_ts <= till
      and e.origin = 'server'
      and e.kind in ('reaction_set', 'reaction_removed', 'comment_sent', 'forward_sent', 'pop_not_interested', 'channel_hidden')
  ),
  per_pop as (
    select
      ev.pop_id,
      date_trunc('hour', ev.event_ts) as hour,
      count(*) filter (where ev.kind = 'reaction_set' and ev.subject_type = 'pop') as reactions,
      count(*) filter (where ev.kind = 'reaction_removed' and ev.subject_type = 'pop') as removed,
      count(*) filter (where ev.kind = 'reaction_removed' and ev.subject_type = 'pop' and (ev.data ->> 'quick')::boolean) as quick,
      coalesce(sum((ev.data ->> 'valence')::real) filter (where ev.kind = 'reaction_set' and ev.subject_type = 'pop'), 0) as valence,
      count(*) filter (where ev.kind = 'comment_sent') as comments,
      count(*) filter (where ev.kind = 'reaction_set' and ev.subject_type = 'comment') as comment_reactions,
      count(*) filter (where ev.kind = 'forward_sent') as forwards,
      count(*) filter (where ev.kind = 'pop_not_interested') as not_interested,
      count(*) filter (where ev.kind = 'channel_hidden') as hidden
    from ev
    join public.pops p on p.id = ev.pop_id
    where not public.can_publish_in_channel(p.channel_id, ev.user_id)
    group by 1, 2
  ),
  stats_rows as (
    insert into public.rec_pop_stats as s (
      pop_id, reactions, reactions_removed, reactions_quick_undo, reaction_valence_sum, comments,
      comment_reactions, forwards, not_interested, channel_hidden
    )
    select pop_id, sum(reactions), sum(removed), sum(quick), sum(valence), sum(comments),
      sum(comment_reactions), sum(forwards), sum(not_interested), sum(hidden)
    from per_pop
    group by pop_id
    on conflict (pop_id) do update set
      reactions = s.reactions + excluded.reactions,
      reactions_removed = s.reactions_removed + excluded.reactions_removed,
      reactions_quick_undo = s.reactions_quick_undo + excluded.reactions_quick_undo,
      reaction_valence_sum = s.reaction_valence_sum + excluded.reaction_valence_sum,
      comments = s.comments + excluded.comments,
      comment_reactions = s.comment_reactions + excluded.comment_reactions,
      forwards = s.forwards + excluded.forwards,
      not_interested = s.not_interested + excluded.not_interested,
      channel_hidden = s.channel_hidden + excluded.channel_hidden,
      updated_at = now()
    returning 1
  ),
  hourly_rows as (
    insert into public.rec_pop_hourly as h (pop_id, hour, reactions, comments, forwards, not_interested)
    select pop_id, hour, reactions, comments, forwards, not_interested
    from per_pop
    on conflict (pop_id, hour) do update set
      reactions = h.reactions + excluded.reactions,
      comments = h.comments + excluded.comments,
      forwards = h.forwards + excluded.forwards,
      not_interested = h.not_interested + excluded.not_interested
    returning 1
  )
  select (select count(*) from stats_rows) into counted;

  -- 6. Сессии приложения.
  select coalesce(array_agg(distinct e.app_session_id), '{}') into sessions
  from public.rec_events e
  where e.server_ts > wm and e.server_ts <= till and e.app_session_id is not null and e.origin = 'client';

  sess := public.rec_rebuild_app_sessions(sessions, wm - max_age);

  update public.rec_app_sessions
  set ended_at = last_seen_at, end_reason = 'lost'
  where ended_at is null and last_seen_at < now() - session_lost;

  -- 7. Окно опоздания прошло — метки закрыты.
  update public.rec_impressions
  set labels_closed_at = now()
  where labels_closed_at is null and ended_at is not null and ended_at + late < now();

  get diagnostics closed = row_count;

  summary := jsonb_build_object(
    'from', wm,
    'to', till,
    'rebuilt', rebuilt,
    'lost', lost_n,
    'applied', applied,
    'relabeled', labeled,
    'label_pops', counted,
    'sessions', sess,
    'closed', closed,
    'ms', round(extract(epoch from (clock_timestamp() - now())) * 1000)
  );

  update public.rec_rollup_state
  set watermark = till, last_run_at = now(), last_summary = summary;

  return summary;
end;
$$;

revoke execute on function public.rec_rollup(timestamptz) from public, anon, authenticated;

-- =============================================================================
-- Расписание
-- =============================================================================

select cron.schedule('rec-journal-rollup', '* * * * *', $$select public.rec_rollup()$$);
select cron.schedule('rec-journal-partitions', '17 * * * *', $$select public.rec_partitions_maintain()$$);
