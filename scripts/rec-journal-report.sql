-- Журнал рекомендаций: отчёт о здоровье и последних показах.
--
--   npx supabase db query --linked -f scripts/rec-journal-report.sql
--
-- Только чтение. Один JSON (db query показывает лишь последний запрос):
--   impressions — последние 20 показов человека с ключевыми полями; человек —
--                 тот, чьё событие пришло последним (свой id — в `who` ниже);
--   health      — событий в минуту по видам за последний час, отказы и дубли
--                 по причинам за сегодня, доля дублей, отставание свёртки,
--                 незакрытые показы, размер таблиц журнала.

with who as (
  select coalesce(
    null::uuid, -- сюда — id человека, чтобы смотреть его
    (select user_id from public.rec_events where origin = 'client' order by server_ts desc limit 1)
  ) as id
),
recent as (
  select
    i.started_at,
    i.surface,
    i.entry,
    i.exit,
    p.title as pop,
    i.is_publisher,
    i.visible_ms,
    i.watch_ms,
    i.duration_ms,
    i.first_frame_ms,
    i.buffering_count,
    i.buffering_ms,
    i.delivery_ok,
    i.loops,
    i.coverage_share,
    i.completed,
    i.quick_skip,
    i.pauses,
    i.pause_ms,
    i.pause_reasons,
    i.seeks_back,
    i.seeks_fwd,
    i.seek_list,
    i.volume_start,
    i.volume_min,
    i.volume_max,
    i.muted,
    i.audio_route,
    i.volume_changes,
    i.route_changes,
    i.comments,
    i.channel_opened,
    i.reaction_emoji,
    i.reaction_valence,
    i.reaction_quick_undo,
    i.comments_sent,
    i.forwards,
    i.subscribed,
    i.not_interested,
    i.channel_hidden,
    i.returned_later,
    i.labels_closed_at is not null as closed
  from public.rec_impressions i
  left join public.pops p on p.id = i.subject_id
  where i.user_id = (select id from who)
  order by i.started_at desc
  limit 20
),
per_kind as (
  select kind, origin, count(*) as events, round(count(*) / 60.0, 2) as per_minute
  from public.rec_events
  where server_ts > now() - interval '1 hour'
  group by kind, origin
),
rejects as (
  select reason, kind, count
  from public.rec_reject_counts
  where day = (now() at time zone 'UTC')::date
),
sizes as (
  select c.relname as "table", pg_total_relation_size(c.oid) as bytes
  from pg_class c
  where c.relkind in ('r', 'p')
    and (
      (c.relnamespace = 'public'::regnamespace and c.relname like 'rec\_%')
      or c.relnamespace = 'rec_parts'::regnamespace
    )
)
select jsonb_build_object(
  'who', (select id from who),
  'impressions', (select coalesce(jsonb_agg(to_jsonb(r) order by r.started_at desc), '[]') from recent r),
  'health', jsonb_build_object(
    'events_last_hour', (select coalesce(jsonb_agg(to_jsonb(k) order by k.events desc), '[]') from per_kind k),
    'rejects_today', (select coalesce(jsonb_agg(to_jsonb(x) order by x.count desc), '[]') from rejects x),
    'duplicate_share_today', (
      select round(
        coalesce(sum(count) filter (where reason = 'duplicate'), 0)::numeric
        / nullif(
            (select count(*) from public.rec_events
             where origin = 'client' and server_ts >= (now() at time zone 'UTC')::date::timestamp at time zone 'UTC')
            + coalesce(sum(count) filter (where reason = 'duplicate'), 0),
            0
          ),
        4
      )
      from rejects
    ),
    'rollup', (
      select jsonb_build_object(
        'lag_seconds', round(extract(epoch from (now() - watermark))),
        'last_run_at', last_run_at,
        'last_summary', last_summary
      )
      from public.rec_rollup_state
    ),
    'open_impressions', (select count(*) from public.rec_impressions where ended_at is null),
    'unlabeled_open', (select count(*) from public.rec_impressions where labels_closed_at is null),
    'cron_failures_last_hour', (
      select count(*)
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
      where j.jobname like 'rec-journal-%' and d.status <> 'succeeded' and d.start_time > now() - interval '1 hour'
    ),
    'table_bytes', (select coalesce(jsonb_object_agg(s."table", s.bytes), '{}') from sizes s),
    'total_bytes', (select coalesce(sum(bytes), 0) from sizes)
  )
) as report;
