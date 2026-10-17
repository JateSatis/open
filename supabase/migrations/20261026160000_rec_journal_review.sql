-- Рекомендации, этап 1: правки по ревью журнала.
--
--   * Правдоподобие снимка показа — по часам телефона. Время от начала показа
--     считалось по `event_ts`, а сдвиг часов оценивается по каждой пачке
--     отдельно и включает задержку сети: начало, ушедшее по холодной сети, и
--     снимок по тёплой расходились на секунды, и честный снимок отклонялся.
--     Оба времени теперь — `client_ts` с одних часов.
--   * Уникальность зрителя попа решается в хронологии показов, а не в порядке
--     пересборки; показ из офлайн-очереди, пришедший позже более позднего,
--     засчитывается, если отстоит от засчитанного дальше окна.
--   * Сессия приложения — своя у хозяина: события другого человека с тем же
--     id в неё не сливаются.
--   * Запас отставания свёртки — 60 с: пачка, закоммиченная позже водяного
--     знака, не теряется (версия конфига 2).

-- Та же функция, что в 20261026110000_rec_journal_ingest.sql, но время
-- показа для правдоподобия — по часам телефона.
/**
 * Пачка событий текущего пользователя. Отдаёт `{accepted: [id], rejected:
 * [{id, reason}]}`: принятые (и повторы уже принятых) клиент снимает из
 * очереди, отклонённые — тоже, с причиной в журнале отладки.
 *
 * Причины: `bad_id`, `foreign_user`, `unknown_kind`, `bad_version`,
 * `bad_shape`, `too_large`, `too_old`, `unknown_subject`, `no_start`,
 * `implausible`.
 */
create or replace function public.rec_record_events(batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  cfg jsonb := public.rec_settings();
  batch_max int := greatest(1, coalesce((cfg ->> 'batchMax')::int, 100));
  per_minute int := greatest(1, coalesce((cfg ->> 'eventsPerMinute')::int, 600));
  data_max int := greatest(256, coalesce((cfg ->> 'dataMaxBytes')::int, 8192));
  max_age interval := make_interval(hours => greatest(1, coalesce((cfg ->> 'maxEventAgeHours')::int, 72)));
  events jsonb;
  sent_at numeric;
  skew interval := interval '0';
  n int;
  recent int;
  e jsonb;
  ev_id uuid;
  kind_ text;
  data_ jsonb;
  ts numeric;
  ev_ts timestamptz;
  subject_type_ text;
  subject_id_ uuid;
  impression uuid;
  surface_ text;
  reason text;
  start_ev record;
  pop_duration int;
  accepted jsonb := '[]'::jsonb;
  rejected jsonb := '[]'::jsonb;
  duplicates int := 0;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  events := batch -> 'events';

  if events is null or jsonb_typeof(events) <> 'array' then
    raise exception 'events must be an array' using errcode = '22023';
  end if;

  n := jsonb_array_length(events);

  if n = 0 then
    return jsonb_build_object('accepted', accepted, 'rejected', rejected);
  end if;

  if n > batch_max then
    raise exception 'too many events in one batch' using errcode = '22023';
  end if;

  -- Две пачки одного человека разом — по очереди: лимит частоты и дедуп не обойти.
  perform pg_advisory_xact_lock(hashtextextended('rec_events:' || caller::text, 0));

  select count(*) into recent
  from public.rec_event_keys
  where user_id = caller and created_at > now() - interval '1 minute';

  if recent + n > per_minute then
    raise exception 'too many events' using errcode = '22023';
  end if;

  sent_at := public.rec_num(batch, 'sent_at');

  if sent_at is not null then
    skew := now() - to_timestamp(sent_at / 1000.0);
  end if;

  for e in select value from jsonb_array_elements(events) loop
    reason := null;
    ev_id := public.uuid_or_null(public.rec_text(e, 'id'));
    kind_ := public.rec_text(e, 'kind');

    if ev_id is null then
      rejected := rejected || jsonb_build_object('id', e -> 'id', 'reason', 'bad_id');
      perform public.rec_count_reject('bad_id', kind_);
      continue;
    end if;

    if exists (select 1 from public.rec_event_keys k where k.user_id = caller and k.client_event_id = ev_id) then
      accepted := accepted || to_jsonb(ev_id);
      duplicates := duplicates + 1;
      continue;
    end if;

    data_ := coalesce(e -> 'data', '{}'::jsonb);
    ts := public.rec_num(e, 'ts');
    subject_type_ := public.rec_text(e, 'subject_type');
    subject_id_ := public.uuid_or_null(public.rec_text(e, 'subject_id'));
    impression := public.uuid_or_null(public.rec_text(e, 'impression_id'));
    surface_ := public.rec_text(e, 'surface');
    ev_ts := least(now(), to_timestamp(coalesce(ts, 0) / 1000.0) + skew);

    if e ? 'user_id' and public.uuid_or_null(public.rec_text(e, 'user_id')) is distinct from caller then
      reason := 'foreign_user';
    elsif kind_ is null or kind_ not in (
      'impression_start', 'impression_progress', 'impression_end', 'channel_opened',
      'comments_session', 'chat_session', 'media_view', 'voice_play', 'reaction_picker',
      'forward_picker', 'search_query', 'search_result_opened', 'app_session_start',
      'app_foreground', 'app_background', 'screen_time'
    ) then
      reason := 'unknown_kind';
    elsif coalesce(public.rec_num(e, 'v'), 1) <> 1 then
      reason := 'bad_version';
    elsif jsonb_typeof(data_) <> 'object' or ts is null
      or (subject_type_ is null) <> (subject_id_ is null)
      or (subject_type_ is not null and subject_type_ not in (
        'pop', 'message', 'comment', 'fragment', 'channel', 'chat', 'profile'
      ))
      or (e ? 'impression_id' and jsonb_typeof(e -> 'impression_id') <> 'null' and impression is null)
      or (e ? 'app_session_id' and jsonb_typeof(e -> 'app_session_id') <> 'null'
          and public.uuid_or_null(public.rec_text(e, 'app_session_id')) is null)
      or (e ? 'screen_session_id' and jsonb_typeof(e -> 'screen_session_id') <> 'null'
          and public.uuid_or_null(public.rec_text(e, 'screen_session_id')) is null)
      or (surface_ is not null and surface_ not in (
        'channel', 'search', 'feed', 'chat', 'comments', 'profile', 'app', 'other'
      )) then
      reason := 'bad_shape';
    elsif octet_length(data_::text) > data_max then
      reason := 'too_large';
    elsif ev_ts < now() - max_age then
      reason := 'too_old';
    end if;

    -- Форма по виду события.
    if reason is null then
      reason := case
        when kind_ = 'impression_start' and (
          subject_type_ is distinct from 'pop' or impression is null or surface_ is null
        ) then 'bad_shape'
        when kind_ in ('impression_progress', 'impression_end') and (
          impression is null
          or public.rec_num(data_, 'watch_ms') is null
          or public.rec_num(data_, 'visible_ms') is null
        ) then 'bad_shape'
        when kind_ = 'impression_end' and coalesce(public.rec_text(data_, 'exit'), '') not in (
          'swipe_next', 'swipe_prev', 'channel', 'tab', 'background', 'close', 'navigate', 'replaced'
        ) then 'bad_shape'
        when kind_ = 'channel_opened' and subject_type_ is distinct from 'channel' then 'bad_shape'
        when kind_ = 'comments_session' and (
          subject_type_ not in ('pop', 'message') or subject_type_ is null
          or public.rec_num(data_, 'ms') is null
        ) then 'bad_shape'
        when kind_ = 'chat_session' and (
          subject_type_ is distinct from 'chat' or public.rec_num(data_, 'ms') is null
        ) then 'bad_shape'
        when kind_ in ('media_view', 'voice_play') and (
          subject_type_ is distinct from 'message' or public.rec_num(data_, 'ms') is null
        ) then 'bad_shape'
        when kind_ in ('reaction_picker', 'forward_picker') and (
          subject_type_ is null or public.rec_text(data_, 'outcome') is null
        ) then 'bad_shape'
        when kind_ = 'search_query' and (
          public.rec_text(data_, 'query') is null or char_length(data_ ->> 'query') > 200
        ) then 'bad_shape'
        when kind_ = 'search_result_opened' and (
          subject_type_ is null or public.rec_num(data_, 'position') is null
        ) then 'bad_shape'
        when kind_ in ('app_session_start', 'app_foreground', 'app_background') and (
          public.uuid_or_null(public.rec_text(e, 'app_session_id')) is null
        ) then 'bad_shape'
        when kind_ = 'screen_time' and (
          public.rec_text(data_, 'screen') is null or public.rec_num(data_, 'ms') is null
        ) then 'bad_shape'
      end;
    end if;

    if reason is null and kind_ = 'impression_start'
       and not exists (select 1 from public.pops p where p.id = subject_id_) then
      reason := 'unknown_subject';
    end if;

    -- Снимок показа сверяется с его началом: тот же человек, тот же объект,
    -- правдоподобные числа.
    if reason is null and kind_ in ('impression_progress', 'impression_end') then
      select x.event_ts, x.client_ts, x.subject_id, x.subject_type into start_ev
      from public.rec_events x
      where x.impression_id = impression
        and x.user_id = caller
        and x.kind = 'impression_start'
        and x.server_ts > now() - max_age
      limit 1;

      if start_ev.event_ts is null then
        reason := 'no_start';
      else
        select p.duration_ms into pop_duration from public.pops p where p.id = start_ev.subject_id;

        if not public.rec_snapshot_plausible(
          data_,
          -- Время показа — по часам телефона: оба времени с одних часов, а
          -- сдвиг, оценённый по каждой пачке отдельно, включает задержку сети.
          extract(epoch from (to_timestamp(ts / 1000.0) - start_ev.client_ts)) * 1000,
          pop_duration,
          cfg
        ) then
          reason := 'implausible';
        end if;

        subject_type_ := start_ev.subject_type;
        subject_id_ := start_ev.subject_id;
      end if;
    end if;

    if reason is not null then
      rejected := rejected || jsonb_build_object('id', ev_id, 'reason', reason);
      perform public.rec_count_reject(reason, kind_);
      continue;
    end if;

    insert into public.rec_event_keys (user_id, client_event_id) values (caller, ev_id);

    insert into public.rec_events (
      user_id, origin, kind, schema_version, client_event_id, app_session_id, screen_session_id,
      impression_id, subject_type, subject_id, surface, client_ts, event_ts, data
    ) values (
      caller,
      'client',
      kind_,
      1,
      ev_id,
      public.uuid_or_null(public.rec_text(e, 'app_session_id')),
      public.uuid_or_null(public.rec_text(e, 'screen_session_id')),
      impression,
      subject_type_,
      subject_id_,
      surface_,
      to_timestamp(ts / 1000.0),
      ev_ts,
      data_
    );

    accepted := accepted || to_jsonb(ev_id);
  end loop;

  if duplicates > 0 then
    perform public.rec_count_reject('duplicate', '', duplicates);
  end if;

  return jsonb_build_object('accepted', accepted, 'rejected', rejected);
end;
$$;

revoke execute on function public.rec_record_events(jsonb) from public, anon;
grant execute on function public.rec_record_events(jsonb) to authenticated;

-- Та же функция, что в 20261026130000_rec_journal_rollup.sql, но в хронологии
-- показов и с поздно пришедшими показами.
create or replace function public.rec_apply_impressions(max_rows int)
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
    -- По времени показа: уникальность в окне решается в хронологии.
    order by x.started_at
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
      -- Показ, пришедший позже более позднего (офлайн-очередь), тоже
      -- засчитывается, если стоит от засчитанного дальше окна.
      counted := viewer.id is null
        or viewer.last_counted_at <= i.started_at - unique_window
        or viewer.last_counted_at >= i.started_at + unique_window;

      if viewer_new then
        insert into public.rec_pop_viewers (pop_id, user_id, first_at, last_counted_at)
        values (i.subject_id, i.user_id, i.started_at, i.started_at);
      elsif counted then
        update public.rec_pop_viewers
        set last_counted_at = greatest(last_counted_at, i.started_at), first_at = least(first_at, i.started_at)
        where id = viewer.id;
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

-- Та же функция, что в 20261026130000_rec_journal_rollup.sql, но в сессию
-- идут только события её хозяина.
create or replace function public.rec_rebuild_app_sessions(ids uuid[], since timestamptz)
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

  with raw as (
    select e.*
    from public.rec_events e
    where e.app_session_id = any (ids) and e.origin = 'client' and e.server_ts > since
  ),
  -- Хозяин сессии — уже записанный, иначе тот, чьё событие пришло первым.
  owners as (
    select distinct on (r.app_session_id)
      r.app_session_id,
      coalesce((select s.user_id from public.rec_app_sessions s where s.id = r.app_session_id), r.user_id) as user_id
    from raw r
    order by r.app_session_id, r.server_ts, r.event_ts
  ),
  ev as (
    select r.*
    from raw r
    join owners o on o.app_session_id = r.app_session_id and o.user_id = r.user_id
  ),
  agg as (
    select
      ev.app_session_id as id,
      ev.user_id,
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
    group by ev.app_session_id, ev.user_id
  ),
  tabs as (
    select ev.app_session_id as id, ev.user_id, jsonb_object_agg(t.tab, t.ms) as tabs
    from (
      select app_session_id, user_id, data ->> 'tab' as tab, sum(public.rec_num(data, 'ms')) as ms
      from ev
      where kind = 'screen_time' and data ? 'tab'
      group by 1, 2, 3
    ) t
    join (select distinct app_session_id, user_id from ev) ev
      on ev.app_session_id = t.app_session_id and ev.user_id = t.user_id
    group by ev.app_session_id, ev.user_id
  ),
  screens as (
    select s.app_session_id as id, s.user_id, jsonb_object_agg(s.screen, s.ms) as screens
    from (
      select app_session_id, user_id, data ->> 'screen' as screen, sum(public.rec_num(data, 'ms')) as ms
      from ev
      where kind = 'screen_time'
      group by 1, 2, 3
    ) s
    group by s.app_session_id, s.user_id
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
  left join tabs t on t.id = a.id and t.user_id = a.user_id
  left join screens sc on sc.id = a.id and sc.user_id = a.user_id
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

insert into public.rec_config (version, params, note)
select 2, params || '{"rollupLagSeconds": 60}', 'Запас отставания свёртки — 60 с'
from public.rec_config where version = 1;
