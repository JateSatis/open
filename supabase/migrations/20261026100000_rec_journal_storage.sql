-- Рекомендации, этап 1: хранилище журнала событий.
--
-- Журнал — фундамент рекомендательной системы и её будущая обучающая
-- выборка: что человек делает с контентом и с людьми, подробно и надолго.
-- Ленты, векторов и ранжирования здесь нет.
--
--   rec_config          параметры журнала по версиям (новая версия — вставка строки)
--   rec_events          сырьё: типизированные действия с контекстом, партиции по дню
--   rec_event_keys      ключи дедупа (человек + client_event_id) и учёт частоты
--   rec_impressions     строка показа: что смотрел, как, чем кончилось, и метки,
--                       дописанные сервером в окне опоздания
--   rec_pop_stats       агрегаты попа, rec_pop_hourly — почасовые корзины за 48 ч,
--                       rec_pop_heat — тепловая карта по сегментам
--   rec_pop_viewers     уникальность зрителя попа (окно уникальности)
--   rec_app_sessions    сессии приложения
--   rec_rollup_state    водяной знак свёртки
--   rec_reject_counts   отказы и дубли приёма по дням и причинам
--   rec_hidden_pops     «не интересно» на поп, rec_hidden_channels — скрытый канал
--
-- Всё закрыто для пользователей (RLS включена, политик нет), кроме своих
-- строк скрытия. Сырьё, ключи и сессии — приватные данные аккаунта и уходят
-- вместе с ним (`on delete cascade`); строки показов и агрегаты теряют автора
-- (`set null`), но остаются в статистике.
--
-- Без облачно-специфичного: декларативные партиции, plpgsql и pg_cron —
-- переезжают на свой Postgres как есть.

-- =============================================================================
-- Конфигурация
-- =============================================================================

create table public.rec_config (
  id uuid primary key default gen_random_uuid (),
  /** Действует строка с наибольшей версией. */
  version int not null unique,
  params jsonb not null,
  note text,
  created_at timestamptz not null default now(),
  constraint rec_config_params_object check (jsonb_typeof(params) = 'object')
);

comment on table public.rec_config is
  'Параметры журнала рекомендаций: лимиты, окна, ретенция, пороги. Меняются вставкой новой версии, без миграции.';

alter table public.rec_config enable row level security;
revoke all on public.rec_config from anon, authenticated;

insert into public.rec_config (version, params, note) values (
  1,
  jsonb_build_object(
    -- Приём.
    'batchMax', 100,
    'eventsPerMinute', 600,
    'dataMaxBytes', 8192,
    'maxEventAgeHours', 72,
    'plausibilityToleranceMs', 1500,
    'plausibilityToleranceShare', 0.05,
    -- Показы.
    'lostTimeoutSeconds', 90,
    'impressionMaxHours', 12,
    'lateWindowHours', 48,
    'quickSkipMs', 2000,
    'normalDeliveryFirstFrameMs', 2000,
    'normalDeliveryBufferingShare', 0.1,
    'completionShare', 0.9,
    'quickUndoMs', 5000,
    'returnGapMinutes', 10,
    -- Агрегаты.
    'uniqueWindowMinutes', 60,
    'newAccountHours', 24,
    'newAccountWeight', 0.25,
    'hourlyKeepHours', 48,
    -- Сессии приложения.
    'appSessionLostSeconds', 1800,
    -- Свёртка и хранение.
    'rollupLagSeconds', 10,
    'rollupMaxWindowMinutes', 60,
    'rawRetentionDays', 90,
    'dedupRetentionDays', 7,
    'partitionsAhead', 7
  ),
  'Стартовые значения этапа 1'
);

/** Действующие параметры журнала. */
create function public.rec_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select params from public.rec_config order by version desc limit 1
$$;

revoke execute on function public.rec_settings() from public, anon, authenticated;

-- =============================================================================
-- Валентность реакций
-- =============================================================================
--
-- Насколько реакция «за» (1) или «против» (−1). Сырьё хранит эмодзи, метка
-- показа — и эмодзи, и валентность на момент свёртки. Новая реакция без
-- валентности в справочник не попадёт.

alter table public.reaction_emojis add column valence numeric(3, 2);

update public.reaction_emojis set valence = case emoji
  when '👍' then 0.6 when '👎' then -0.6 when '❤️' then 1 when '🔥' then 0.9
  when '🥰' then 1 when '👏' then 0.8 when '😁' then 0.7 when '🤔' then 0
  when '🤯' then 0.5 when '😱' then 0 when '🤬' then -0.9 when '😢' then -0.3
  when '🎉' then 0.8 when '🤩' then 0.9 when '🤮' then -1 when '💩' then -0.9
  when '🙏' then 0.6 when '👌' then 0.6 when '🕊️' then 0.4 when '🤡' then -0.6
  when '🥱' then -0.7 when '🥴' then -0.2 when '😍' then 1 when '🐳' then 0.3
  when '❤️‍🔥' then 1 when '🌚' then 0.2 when '🌭' then 0.2 when '💯' then 0.9
  when '🤣' then 0.8 when '⚡' then 0.6 when '🍌' then 0.1 when '🏆' then 0.9
  when '💔' then -0.5 when '🤨' then -0.3 when '😐' then -0.2 when '🍓' then 0.4
  when '🍾' then 0.7 when '💋' then 0.8 when '😈' then 0.3 when '😴' then -0.7
  when '😭' then 0 when '🤓' then 0.2 when '👻' then 0.1 when '👨‍💻' then 0.3
  when '👀' then 0.3 when '🎃' then 0.2 when '🙈' then 0.2 when '😇' then 0.6
  when '😨' then -0.3 when '🤝' then 0.6 when '✍️' then 0.4 when '🤗' then 0.8
  when '🫡' then 0.5 when '🎅' then 0.3 when '🎄' then 0.3 when '☃️' then 0.3
  when '💅' then 0.3 when '🤪' then 0.5 when '🗿' then 0 when '🆒' then 0.7
  when '💘' then 0.9 when '🙉' then 0.1 when '🦄' then 0.5 when '😘' then 0.8
  when '💊' then 0 when '🙊' then 0.2 when '😎' then 0.7 when '👾' then 0.3
  when '🤷' then -0.1 when '😡' then -0.9
end;

alter table public.reaction_emojis
  alter column valence set not null,
  add constraint reaction_emojis_valence_range check (valence between -1 and 1);

-- =============================================================================
-- Сырые события
-- =============================================================================
--
-- Append-only. Горячие поля — колонками, остальное — компактный `data`,
-- форму которого по виду события проверяет функция приёма. Клиент пишет
-- только то, чего сервер знать не может; серверные события (`origin =
-- 'server'`) кладут триггеры таблиц, где действие уже записано.
--
-- Время: `client_ts` — как прислал клиент, `server_ts` — время приёма (ключ
-- партиции и водяного знака свёртки), `event_ts` — время события на часах
-- сервера: `client_ts`, сдвинутое на разницу часов пачки, не позже приёма.

create table public.rec_events (
  id uuid not null default gen_random_uuid (),
  server_ts timestamptz not null default now(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  origin text not null,
  kind text not null,
  schema_version smallint not null default 1,
  client_event_id uuid,
  app_session_id uuid,
  screen_session_id uuid,
  impression_id uuid,
  subject_type text,
  subject_id uuid,
  surface text,
  client_ts timestamptz,
  event_ts timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  primary key (id, server_ts),
  constraint rec_events_origin check (origin in ('client', 'server')),
  constraint rec_events_client_id check ((origin = 'client') = (client_event_id is not null)),
  constraint rec_events_subject check (
    (subject_type is null) = (subject_id is null)
    and (subject_type is null or subject_type in (
      'pop', 'message', 'comment', 'fragment', 'channel', 'chat', 'profile'
    ))
  ),
  constraint rec_events_data_object check (jsonb_typeof(data) = 'object')
) partition by range (server_ts);

comment on table public.rec_events is
  'Журнал рекомендаций: сырые действия людей, партиции по дню, ретенция из rec_config. Пользователям закрыт.';

-- Страховка: вставка не падает, даже если партиции дня ещё нет. Строки
-- отсюда переезжают в свою партицию при её создании.
create table public.rec_events_default partition of public.rec_events default;

create index rec_events_user_ts_idx on public.rec_events (user_id, server_ts);
create index rec_events_impression_idx on public.rec_events (impression_id) where impression_id is not null;
create index rec_events_app_session_idx on public.rec_events (app_session_id) where app_session_id is not null;
create index rec_events_server_ts_idx on public.rec_events (server_ts);

alter table public.rec_events enable row level security;
alter table public.rec_events_default enable row level security;
revoke all on public.rec_events, public.rec_events_default from anon, authenticated;

-- Дедуп клиентских событий: партиционированная таблица не держит
-- уникальность без ключа партиции, поэтому ключи — отдельно и ненадолго
-- (`dedupRetentionDays`: клиент старше событий не шлёт). Отсюда же — лимит
-- частоты.
create table public.rec_event_keys (
  user_id uuid not null references public.profiles (id) on delete cascade,
  client_event_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, client_event_id)
);

create index rec_event_keys_user_created_idx on public.rec_event_keys (user_id, created_at);
create index rec_event_keys_created_idx on public.rec_event_keys (created_at);

alter table public.rec_event_keys enable row level security;
revoke all on public.rec_event_keys from anon, authenticated;

-- Отказы и дубли приёма — для наблюдаемости, без самих событий.
create table public.rec_reject_counts (
  id uuid primary key default gen_random_uuid (),
  day date not null,
  reason text not null,
  kind text not null default '',
  count int not null default 0,
  created_at timestamptz not null default now(),
  constraint rec_reject_counts_key unique (day, reason, kind)
);

alter table public.rec_reject_counts enable row level security;
revoke all on public.rec_reject_counts from anon, authenticated;

-- =============================================================================
-- Партиции
-- =============================================================================

/**
 * Партиции сырья на `partitionsAhead` дней вперёд от `at`; партиции старше
 * `rawRetentionDays` удаляются вместе с днём. Строки из партиции по
 * умолчанию переезжают в созданную. Заодно — уборка ключей дедупа, почасовых
 * корзин и счётчиков отказов. Повторный вызов ничего не меняет.
 */
create function public.rec_partitions_maintain(at timestamptz default now())
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

    continue when to_regclass('public.' || name) is not null;
    -- Уже за ретенцией — не создавать, чтобы тут же не удалять.
    continue when d < today - keep_days;

    if exists (select 1 from public.rec_events_default where server_ts >= lo and server_ts < hi) then
      execute format('create table public.%I (like public.rec_events including defaults including constraints)', name);
      execute format(
        'insert into public.%I select * from public.rec_events_default where server_ts >= %L and server_ts < %L',
        name, lo, hi
      );
      delete from public.rec_events_default where server_ts >= lo and server_ts < hi;
      execute format(
        'alter table public.rec_events attach partition public.%I for values from (%L) to (%L)', name, lo, hi
      );
    else
      execute format(
        'create table public.%I partition of public.rec_events for values from (%L) to (%L)', name, lo, hi
      );
    end if;

    execute format('alter table public.%I enable row level security', name);
    execute format('revoke all on public.%I from anon, authenticated', name);
    created := created || name;
  end loop;

  for part in
    select c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname = 'rec_events'
      and p.relnamespace = 'public'::regnamespace
      and c.relname ~ '^rec_events_p[0-9]{8}$'
      and to_date(substr(c.relname, 13), 'YYYYMMDD') < today - keep_days
  loop
    execute format('drop table public.%I', part.relname);
    dropped := dropped || part.relname::text;
  end loop;

  delete from public.rec_events_default where server_ts < (today - keep_days)::timestamp at time zone 'UTC';
  delete from public.rec_event_keys where created_at < at - make_interval(days => dedup_days);
  delete from public.rec_pop_hourly where hour < at - make_interval(hours => hourly_hours);
  delete from public.rec_reject_counts r where r.day < today - keep_days;

  return jsonb_build_object('created', to_jsonb(created), 'dropped', to_jsonb(dropped));
end;
$$;

revoke execute on function public.rec_partitions_maintain(timestamptz) from public, anon, authenticated;

-- =============================================================================
-- Показы
-- =============================================================================
--
-- Одна строка на показ (id — `impression_id` клиента). Собирается свёрткой из
-- событий жизненного цикла показа и пересобирается целиком, когда приходит
-- новое: повтор свёртки ничего не меняет. Метки — то, что человек сделал
-- после показа и что сервер знает сам (реакция, комментарий, пересылка,
-- подписка, скрытие); дописываются в окне опоздания (`lateWindowHours`),
-- после него строка закрыта (`labels_closed_at`) и готова для обучения.

create table public.rec_impressions (
  id uuid primary key,
  user_id uuid references public.profiles (id) on delete set null,
  subject_type text not null,
  subject_id uuid not null,
  /** Канал попа: метки уровня канала (подписка, скрытие). */
  channel_id uuid,
  app_session_id uuid,
  surface text not null,
  entry text,
  -- Выдача: заполнит этап 3, вне ленты — null.
  request_id uuid,
  position int,
  source text,
  algo_version text,
  /** Смотрел публикующий в канале — в статистику не идёт. */
  is_publisher boolean not null default false,
  started_at timestamptz not null,
  ended_at timestamptz,
  last_seen_at timestamptz not null,
  exit text,
  -- Просмотр.
  duration_ms int,
  visible_ms int not null default 0,
  watch_ms int not null default 0,
  max_pos_ms int not null default 0,
  segment_ms int,
  segments smallint,
  /** Карта покрытия: бит i — посмотрен сегмент i. Сегмент — 1 с, у длинных — 2% длины. */
  coverage bigint not null default 0,
  coverage_share real not null default 0,
  loops int not null default 0,
  pauses int not null default 0,
  pause_ms int not null default 0,
  pause_reasons jsonb not null default '{}'::jsonb,
  pause_list jsonb not null default '[]'::jsonb,
  seeks_back int not null default 0,
  seeks_fwd int not null default 0,
  seek_back_ms int not null default 0,
  seek_fwd_ms int not null default 0,
  seek_list jsonb not null default '[]'::jsonb,
  -- Доставка.
  first_frame_ms int,
  buffering_count int not null default 0,
  buffering_ms int not null default 0,
  error text,
  delivery_ok boolean,
  -- Звук и устройство.
  volume_start real,
  volume_min real,
  volume_max real,
  muted boolean,
  audio_route text,
  volume_changes jsonb not null default '[]'::jsonb,
  route_changes jsonb not null default '[]'::jsonb,
  network text,
  orientation text,
  -- Комментарии за показ: открытия, время, показано.
  comments jsonb not null default '{}'::jsonb,
  -- Выводы свёртки.
  completed boolean not null default false,
  quick_skip boolean not null default false,
  -- Метки сервера.
  channel_opened boolean not null default false,
  reaction_emoji text,
  reaction_valence real,
  reaction_at timestamptz,
  reaction_quick_undo boolean not null default false,
  comments_sent int not null default 0,
  comment_chars int not null default 0,
  comment_voice boolean not null default false,
  comment_reply boolean not null default false,
  comment_reactions int not null default 0,
  forwards int not null default 0,
  forward_recipients int not null default 0,
  forward_chat_kinds text[] not null default '{}',
  subscribed boolean not null default false,
  unsubscribed boolean not null default false,
  not_interested boolean not null default false,
  channel_hidden boolean not null default false,
  returned_later boolean not null default false,
  labels_closed_at timestamptz,
  -- Служебное свёртки: когда пересобрана и что уже внесено в агрегаты.
  rebuilt_at timestamptz not null default now(),
  applied_at timestamptz,
  applied jsonb,
  created_at timestamptz not null default now(),
  constraint rec_impressions_subject check (subject_type in ('pop', 'message'))
);

comment on table public.rec_impressions is
  'Показ объекта человеку: поведение, доставка, звук и метки сервера в окне опоздания. Пользователям закрыта.';

create index rec_impressions_user_subject_idx on public.rec_impressions (user_id, subject_id, started_at);
create index rec_impressions_user_channel_idx on public.rec_impressions (user_id, channel_id, started_at)
  where channel_id is not null;
create index rec_impressions_open_idx on public.rec_impressions (last_seen_at) where ended_at is null;
create index rec_impressions_labels_open_idx on public.rec_impressions (ended_at) where labels_closed_at is null;
create index rec_impressions_unapplied_idx on public.rec_impressions (rebuilt_at)
  where ended_at is not null and (applied_at is null or applied_at < rebuilt_at);
create index rec_impressions_subject_idx on public.rec_impressions (subject_id, started_at);

alter table public.rec_impressions enable row level security;
revoke all on public.rec_impressions from anon, authenticated;

-- =============================================================================
-- Агрегаты попа
-- =============================================================================

create table public.rec_pop_stats (
  pop_id uuid primary key references public.pops (id) on delete cascade,
  /** Все закрытые показы, не публикующих. */
  impressions_raw int not null default 0,
  /** Показы с окном уникальности: один человек — не чаще раза в окно. */
  impressions int not null default 0,
  viewers int not null default 0,
  /** Зрители с весом доверия: молодые аккаунты — с меньшим. */
  viewers_weighted real not null default 0,
  watch_ms bigint not null default 0,
  completions int not null default 0,
  quick_skips int not null default 0,
  loops int not null default 0,
  delivery_bad int not null default 0,
  channel_opens int not null default 0,
  reactions int not null default 0,
  reactions_removed int not null default 0,
  reactions_quick_undo int not null default 0,
  reaction_valence_sum real not null default 0,
  comments int not null default 0,
  comment_reactions int not null default 0,
  forwards int not null default 0,
  not_interested int not null default 0,
  channel_hidden int not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.rec_pop_stats is
  'Агрегаты попа для ранжирования: показы, зрители, досмотры, метки. Пишет свёртка, пользователям закрыта.';

alter table public.rec_pop_stats enable row level security;
revoke all on public.rec_pop_stats from anon, authenticated;

create table public.rec_pop_hourly (
  id uuid primary key default gen_random_uuid (),
  pop_id uuid not null references public.pops (id) on delete cascade,
  hour timestamptz not null,
  impressions int not null default 0,
  viewers int not null default 0,
  watch_ms bigint not null default 0,
  completions int not null default 0,
  quick_skips int not null default 0,
  reactions int not null default 0,
  comments int not null default 0,
  forwards int not null default 0,
  not_interested int not null default 0,
  created_at timestamptz not null default now(),
  constraint rec_pop_hourly_key unique (pop_id, hour)
);

create index rec_pop_hourly_hour_idx on public.rec_pop_hourly (hour);

alter table public.rec_pop_hourly enable row level security;
revoke all on public.rec_pop_hourly from anon, authenticated;

/** Тепловая карта попа: по сегменту — просмотры, перемотки назад в него и вперёд из него, паузы. */
create table public.rec_pop_heat (
  pop_id uuid primary key references public.pops (id) on delete cascade,
  segment_ms int not null,
  views int[] not null default '{}',
  seeks_back_into int[] not null default '{}',
  seeks_fwd_from int[] not null default '{}',
  pauses int[] not null default '{}',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.rec_pop_heat enable row level security;
revoke all on public.rec_pop_heat from anon, authenticated;

/** Кто уже смотрел поп: уникальный зритель и окно уникальности показов. */
create table public.rec_pop_viewers (
  id uuid primary key default gen_random_uuid (),
  pop_id uuid not null references public.pops (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  first_at timestamptz not null,
  last_counted_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint rec_pop_viewers_key unique (pop_id, user_id)
);

create index rec_pop_viewers_user_idx on public.rec_pop_viewers (user_id);

alter table public.rec_pop_viewers enable row level security;
revoke all on public.rec_pop_viewers from anon, authenticated;

-- =============================================================================
-- Сессии приложения
-- =============================================================================

create table public.rec_app_sessions (
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  last_seen_at timestamptz not null,
  foreground_ms bigint not null default 0,
  /** cold — холодный старт, resume — возврат из фона, push, link. */
  entry text,
  platform text,
  app_version text,
  tabs jsonb not null default '{}'::jsonb,
  screens jsonb not null default '{}'::jsonb,
  last_screen text,
  /** background — ушёл в фон, lost — пропал без события. */
  end_reason text,
  events int not null default 0,
  impressions int not null default 0,
  rebuilt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index rec_app_sessions_user_idx on public.rec_app_sessions (user_id, started_at);
create index rec_app_sessions_open_idx on public.rec_app_sessions (last_seen_at) where ended_at is null;

alter table public.rec_app_sessions enable row level security;
revoke all on public.rec_app_sessions from anon, authenticated;

-- =============================================================================
-- Водяной знак свёртки
-- =============================================================================

create table public.rec_rollup_state (
  id boolean primary key default true check (id),
  watermark timestamptz not null default now(),
  last_run_at timestamptz,
  last_summary jsonb,
  created_at timestamptz not null default now()
);

insert into public.rec_rollup_state default values;

alter table public.rec_rollup_state enable row level security;
revoke all on public.rec_rollup_state from anon, authenticated;

-- =============================================================================
-- Скрытие: «не интересно» и скрытый канал
-- =============================================================================
--
-- Состояние, не история: снятие удаляет строку физически, как отписка.
-- История — в журнале (триггеры ниже по миграциям). Свои строки человек
-- читает сам, пишут только функции.

create table public.rec_hidden_pops (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pop_id uuid not null references public.pops (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint rec_hidden_pops_key unique (user_id, pop_id)
);

create index rec_hidden_pops_pop_idx on public.rec_hidden_pops (pop_id);

create table public.rec_hidden_channels (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  /** Из «⋯» какого попа скрыт — для метки показа. */
  from_pop_id uuid references public.pops (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint rec_hidden_channels_key unique (user_id, channel_id)
);

create index rec_hidden_channels_channel_idx on public.rec_hidden_channels (channel_id);

alter table public.rec_hidden_pops enable row level security;
alter table public.rec_hidden_channels enable row level security;
revoke all on public.rec_hidden_pops, public.rec_hidden_channels from anon, authenticated;
grant select on public.rec_hidden_pops, public.rec_hidden_channels to authenticated;

create policy "people read their own hidden pops"
  on public.rec_hidden_pops for select
  to authenticated
  using (user_id = auth.uid());

create policy "people read their own hidden channels"
  on public.rec_hidden_channels for select
  to authenticated
  using (user_id = auth.uid());

/** «Не интересно» на поп: поставить (`value = true`) или снять. */
create function public.set_pop_not_interested(target_pop uuid, value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if value then
    if not exists (select 1 from public.pops where id = target_pop and deleted_at is null) then
      raise exception 'pop not found' using errcode = 'P0002';
    end if;

    insert into public.rec_hidden_pops (user_id, pop_id)
    values (caller, target_pop)
    on conflict (user_id, pop_id) do nothing;
  else
    delete from public.rec_hidden_pops where user_id = caller and pop_id = target_pop;
  end if;
end;
$$;

revoke execute on function public.set_pop_not_interested(uuid, boolean) from public, anon;
grant execute on function public.set_pop_not_interested(uuid, boolean) to authenticated;

/**
 * Скрыть канал из ленты (`value = true`) или показывать снова. `from_pop` —
 * поп, из «⋯» которого скрыли. Подписка на канал снимает скрытие сама.
 */
create function public.set_channel_hidden(target_channel uuid, value boolean, from_pop uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if value then
    if not exists (select 1 from public.channels where id = target_channel and deleted_at is null) then
      raise exception 'channel not found' using errcode = 'P0002';
    end if;

    insert into public.rec_hidden_channels (user_id, channel_id, from_pop_id)
    values (
      caller,
      target_channel,
      (select p.id from public.pops p where p.id = from_pop and p.channel_id = target_channel)
    )
    on conflict (user_id, channel_id) do nothing;
  else
    delete from public.rec_hidden_channels where user_id = caller and channel_id = target_channel;
  end if;
end;
$$;

revoke execute on function public.set_channel_hidden(uuid, boolean, uuid) from public, anon;
grant execute on function public.set_channel_hidden(uuid, boolean, uuid) to authenticated;

-- Подписка на канал снимает его скрытие.
create function public.rec_unhide_on_subscribe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.channel_id is not null then
    delete from public.rec_hidden_channels
    where user_id = new.subscriber_id and channel_id = new.channel_id;
  end if;

  return null;
end;
$$;

revoke execute on function public.rec_unhide_on_subscribe() from public, anon, authenticated;

create trigger subscriptions_unhide_channel
  after insert on public.subscriptions
  for each row execute function public.rec_unhide_on_subscribe();

-- Партиции на ближайшие дни — сразу.
select public.rec_partitions_maintain();
