-- Рекомендации, этап 1: приём событий клиента.
--
-- Клиент шлёт пачку одной функцией. Повтор пачки ничего не дублирует
-- (ключ — человек + `client_event_id`), чужое имя, неизвестный вид, кривая
-- форма и неправдоподобные числа отклоняются с причиной, чтобы клиент снял
-- их из очереди и не слал вечно. Пачка больше лимита и превышение частоты —
-- отказ целиком: клиент подождёт и повторит.
--
-- Пачка: `{sent_at, events: [{id, kind, v, ts, user_id?, app_session_id?,
-- screen_session_id?, impression_id?, subject_type?, subject_id?, surface?,
-- data}]}`. Время — миллисекунды эпохи по часам телефона; `sent_at` — когда
-- пачка ушла, по нему сервер узнаёт сдвиг часов и ставит событию `event_ts`
-- на своих часах.
--
-- Жизненный цикл показа: `impression_start` → `impression_progress` (снимок
-- раз в несколько секунд, пока показ идёт) → `impression_end` (итоговый
-- снимок и причина выхода). Показ без конца закрывает свёртка с `exit = lost`
-- по последнему снимку.

/** Число из поля json или null, если там не число. */
create function public.rec_num(j jsonb, key text)
returns numeric
language sql
immutable
as $$
  select case when jsonb_typeof(j -> key) = 'number' then (j ->> key)::numeric end
$$;

/** Текст из поля json или null, если там не строка. */
create function public.rec_text(j jsonb, key text)
returns text
language sql
immutable
as $$
  select case when jsonb_typeof(j -> key) = 'string' then j ->> key end
$$;

/** Длина сегмента карты покрытия: 1 с, у длинных — 2% длины (не больше 50 сегментов). */
create function public.rec_segment_ms(duration_ms int)
returns int
language sql
immutable
as $$
  select greatest(1000, ceil(coalesce(duration_ms, 0) * 0.02)::int)
$$;

create function public.rec_segments(duration_ms int)
returns int
language sql
immutable
as $$
  select greatest(1, ceil(coalesce(duration_ms, 0)::numeric / public.rec_segment_ms(duration_ms))::int)
$$;

revoke execute on function public.rec_num(jsonb, text) from public, anon, authenticated;
revoke execute on function public.rec_text(jsonb, text) from public, anon, authenticated;
revoke execute on function public.rec_segment_ms(int) from public, anon, authenticated;
revoke execute on function public.rec_segments(int) from public, anon, authenticated;

/** Отказ или дубль — в счётчики наблюдаемости. */
create function public.rec_count_reject(why text, event_kind text, n int default 1)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.rec_reject_counts (day, reason, kind, count)
  values ((now() at time zone 'UTC')::date, why, coalesce(event_kind, ''), n)
  on conflict (day, reason, kind) do update set count = rec_reject_counts.count + excluded.count
$$;

revoke execute on function public.rec_count_reject(text, text, int) from public, anon, authenticated;

/**
 * Снимок показа правдоподобен: просмотр не дольше реального времени показа и
 * длины попа × (круги + 1), позиции — в пределах длины, карта покрытия — в
 * пределах сегментов. `elapsed_ms` — время от начала показа до снимка.
 */
create function public.rec_snapshot_plausible(snap jsonb, elapsed_ms numeric, duration_ms int, cfg jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  tol numeric := coalesce((cfg ->> 'plausibilityToleranceMs')::numeric, 1500)
    + coalesce((cfg ->> 'plausibilityToleranceShare')::numeric, 0.05) * greatest(elapsed_ms, 0);
  dur numeric := greatest(coalesce(duration_ms, 0), 1);
  watch numeric := public.rec_num(snap, 'watch_ms');
  visible numeric := public.rec_num(snap, 'visible_ms');
  loops numeric := coalesce(public.rec_num(snap, 'loops'), 0);
  max_pos numeric := coalesce(public.rec_num(snap, 'max_pos_ms'), 0);
  coverage numeric := coalesce(public.rec_num(snap, 'coverage'), 0);
  item jsonb;
begin
  if watch is null or visible is null or watch < 0 or visible < 0 or loops < 0 or max_pos < 0 then
    return false;
  end if;

  if watch > elapsed_ms + tol or visible > elapsed_ms + tol then
    return false;
  end if;

  if watch > dur * (loops + 1) + tol then
    return false;
  end if;

  if max_pos > dur + tol then
    return false;
  end if;

  if coverage < 0 or coverage <> trunc(coverage) or coverage >= power(2::numeric, public.rec_segments(duration_ms)) then
    return false;
  end if;

  if jsonb_typeof(snap -> 'seeks') = 'array' then
    for item in select value from jsonb_array_elements(snap -> 'seeks') loop
      if coalesce(public.rec_num(item, 'from'), -1) < 0 or coalesce(public.rec_num(item, 'from'), 0) > dur + tol
         or coalesce(public.rec_num(item, 'to'), -1) < 0 or coalesce(public.rec_num(item, 'to'), 0) > dur + tol then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$$;

revoke execute on function public.rec_snapshot_plausible(jsonb, numeric, int, jsonb) from public, anon, authenticated;

/**
 * Пачка событий текущего пользователя. Отдаёт `{accepted: [id], rejected:
 * [{id, reason}]}`: принятые (и повторы уже принятых) клиент снимает из
 * очереди, отклонённые — тоже, с причиной в журнале отладки.
 *
 * Причины: `bad_id`, `foreign_user`, `unknown_kind`, `bad_version`,
 * `bad_shape`, `too_large`, `too_old`, `unknown_subject`, `no_start`,
 * `implausible`.
 */
create function public.rec_record_events(batch jsonb)
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
      select x.event_ts, x.subject_id, x.subject_type into start_ev
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
          extract(epoch from (ev_ts - start_ev.event_ts)) * 1000,
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
