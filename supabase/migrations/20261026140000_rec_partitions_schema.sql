-- Рекомендации, этап 1: партиции сырья журнала — в своей схеме.
--
-- Дневные партиции `rec_events` в `public` попадали в сгенерированные типы
-- клиента (по таблице на день) и в API PostgREST. Теперь они живут в схеме
-- `rec_parts`, закрытой для клиента целиком; родитель `public.rec_events`
-- остаётся на месте, запросы и функции к нему не меняются.

create schema if not exists rec_parts;

revoke all on schema rec_parts from public, anon, authenticated;

do $$
declare
  part record;
begin
  for part in
    select c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.rec_events'::regclass
      and c.relnamespace = 'public'::regnamespace
  loop
    execute format('alter table public.%I set schema rec_parts', part.relname);
  end loop;
end;
$$;

-- Та же функция, что в 20261026100000_rec_journal_storage.sql, но партиции —
-- в `rec_parts`.
create or replace function public.rec_partitions_maintain(at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg jsonb := public.rec_settings();
  ahead int := greatest(1, coalesce((cfg ->> 'partitionsAhead')::int, 7));
  keep_days int := greatest(1, coalesce((cfg ->> 'rawRetentionDays')::int, 90));
  dedup_days int := greatest(1, coalesce((cfg ->> 'dedupRetentionDays')::int, 7));
  hourly_hours int := greatest(1, coalesce((cfg ->> 'hourlyKeepHours')::int, 48));
  today date := (at at time zone 'UTC')::date;
  d date;
  name text;
  lo timestamptz;
  hi timestamptz;
  created text[] := '{}';
  dropped text[] := '{}';
  part record;
begin
  -- Две уборки разом не идут: обе создавали бы одну партицию.
  perform pg_advisory_xact_lock(hashtextextended('rec_partitions_maintain', 0));

  for i in 0 .. ahead loop
    d := today + i;
    name := 'rec_events_p' || to_char(d, 'YYYYMMDD');
    lo := (d::timestamp at time zone 'UTC');
    hi := ((d + 1)::timestamp at time zone 'UTC');

    continue when to_regclass('rec_parts.' || name) is not null;
    -- Уже за ретенцией — не создавать, чтобы тут же не удалять.
    continue when d < today - keep_days;

    if exists (select 1 from rec_parts.rec_events_default where server_ts >= lo and server_ts < hi) then
      execute format('create table rec_parts.%I (like public.rec_events including defaults including constraints)', name);
      execute format(
        'insert into rec_parts.%I select * from rec_parts.rec_events_default where server_ts >= %L and server_ts < %L',
        name, lo, hi
      );
      delete from rec_parts.rec_events_default where server_ts >= lo and server_ts < hi;
      execute format(
        'alter table public.rec_events attach partition rec_parts.%I for values from (%L) to (%L)', name, lo, hi
      );
    else
      execute format(
        'create table rec_parts.%I partition of public.rec_events for values from (%L) to (%L)', name, lo, hi
      );
    end if;

    execute format('alter table rec_parts.%I enable row level security', name);
    execute format('revoke all on rec_parts.%I from anon, authenticated', name);
    created := created || name;
  end loop;

  for part in
    select c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.rec_events'::regclass
      and c.relnamespace = 'rec_parts'::regnamespace
      and c.relname ~ '^rec_events_p[0-9]{8}$'
      and to_date(substr(c.relname, 13), 'YYYYMMDD') < today - keep_days
  loop
    execute format('drop table rec_parts.%I', part.relname);
    dropped := dropped || part.relname::text;
  end loop;

  delete from rec_parts.rec_events_default where server_ts < (today - keep_days)::timestamp at time zone 'UTC';
  delete from public.rec_event_keys where created_at < at - make_interval(days => dedup_days);
  delete from public.rec_pop_hourly where hour < at - make_interval(hours => hourly_hours);
  delete from public.rec_reject_counts r where r.day < today - keep_days;

  return jsonb_build_object('created', to_jsonb(created), 'dropped', to_jsonb(dropped));
end;
$$;

revoke execute on function public.rec_partitions_maintain(timestamptz) from public, anon, authenticated;
