-- Выделенные фрагменты, этап 3а: серверная модель кластеров.
--
-- Кластер — диапазон текста сообщения, вокруг которого собрались фрагменты
-- (реакции и комментарии на куски текста). Считает кластеры модель вне базы
-- (`supabase/functions/_shared/fragmentClusters.ts`): обработчик очереди
-- забирает заявку, читает снимок сообщения (`fragment_clusters_claim`),
-- считает и пишет результат короткой транзакцией (`fragment_clusters_apply`).
-- Брокер — pgmq, обработчик будит pg_cron через pg_net.
--
-- Между пересчётами кластер живёт: новый фрагмент, пересекающий кластер,
-- сразу в него входит; реакция и комментарий к фрагменту кластера сразу
-- меняют его сводные счётчики. У человека в кластере одна живая реакция:
-- новая мягко снимает прежнюю на другом фрагменте того же кластера.
--
-- Блокировки. Запись результата пересчёта берёт эксклюзивную advisory-
-- блокировку сообщения; всё, что меняет фрагменты сообщения (реакции,
-- комментарии к фрагментам, создание фрагмента, правка текста), берёт её же
-- разделяемой — и всегда до блокировки строк фрагментов. Реакции друг друга
-- не ждут, запись пересчёта ждёт их и наоборот, но только на время короткой
-- транзакции записи. Сама запись не трогает строку сообщения.

create extension if not exists pgmq;
create extension if not exists pg_net;

select pgmq.create('fragment_clusters');

-- Очередь — служебная: клиентам ни читать, ни писать.
revoke all on pgmq.q_fragment_clusters, pgmq.a_fragment_clusters from anon, authenticated;
alter table pgmq.q_fragment_clusters enable row level security;
alter table pgmq.a_fragment_clusters enable row level security;

-- =============================================================================
-- Конфигурация модели
-- =============================================================================

create table public.fragment_cluster_config (
  id uuid primary key default gen_random_uuid (),
  /** Действует строка с наибольшей версией. Её номер пишется в кластеры. */
  version int not null unique,
  /**
   * Параметры модели (`ClusterParams` в fragmentClusters.ts — имена те же) и
   * очереди: eagerInteractions, thresholdDoublings, thresholdStep,
   * staleInteractions, leaseSeconds.
   */
  params jsonb not null,
  note text,
  created_at timestamptz not null default now(),
  constraint fragment_cluster_config_params_object check (jsonb_typeof(params) = 'object')
);

comment on table public.fragment_cluster_config is
  'Параметры модели кластеров фрагментов. Меняются вставкой новой версии, без миграции.';

alter table public.fragment_cluster_config enable row level security;
revoke all on public.fragment_cluster_config from anon, authenticated;

insert into public.fragment_cluster_config (version, params, note) values (
  1,
  jsonb_build_object(
    'mergeGap', 2,
    'splitLength', 200,
    'splitCrossShare', 0.34,
    'weightPerson', 1,
    'weightReaction', 0.5,
    'weightComment', 1.5,
    'maxDisplayLength', 200,
    'slotChars', 100,
    'maxDisplayed', 8,
    'maxCoverageShare', 0.5,
    'minRelativePopularity', 0.15,
    'densityPenalty', 0.6,
    'densityRadius', 120,
    'eagerInteractions', 20,
    'thresholdDoublings', 2,
    'thresholdStep', 100,
    'staleInteractions', 10,
    'leaseSeconds', 30
  ),
  'Стартовые значения этапа 3а'
);

/** Действующая конфигурация. */
create function public.fragment_cluster_settings()
returns public.fragment_cluster_config
language sql
stable
security definer
set search_path = public
as $$
  select * from public.fragment_cluster_config order by version desc limit 1
$$;

revoke execute on function public.fragment_cluster_settings() from public, anon, authenticated;

-- =============================================================================
-- Кластеры
-- =============================================================================

create table public.fragment_clusters (
  id uuid primary key default gen_random_uuid (),
  message_id uuid not null,
  chat_id uuid not null,
  /** Диапазон кластера модели, code points. */
  start_offset int not null,
  end_offset int not null,
  /** Что показывать на тексте: по словам, без пересечений. Оба null — не показывается. */
  display_start int,
  display_end int,
  popularity double precision not null default 0,
  member_reactions jsonb not null default '{}'::jsonb,
  visitor_reactions jsonb not null default '{}'::jsonb,
  reactions_count int not null default 0,
  comments_count int not null default 0,
  /** Разных людей с реакцией или комментарием на фрагментах кластера. */
  people_count int not null default 0,
  /** Версия конфигурации, которой посчитан. */
  model_version int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint fragment_clusters_range check (start_offset >= 0 and end_offset > start_offset),
  constraint fragment_clusters_display check (
    (display_start is null and display_end is null)
    or (display_start >= 0 and display_end > display_start)
  ),
  constraint fragment_clusters_message_fkey
    foreign key (message_id, chat_id) references public.messages (id, chat_id) on delete cascade,
  constraint fragment_clusters_id_message_key unique (id, message_id)
);

comment on table public.fragment_clusters is
  'Кластеры фрагментов текста сообщения. Пишут только функции модели и триггеры счётчиков.';

create index fragment_clusters_message_id_idx
  on public.fragment_clusters (message_id)
  where deleted_at is null;

alter table public.fragment_clusters enable row level security;

create policy "displayed fragment_clusters are readable by authenticated users"
  on public.fragment_clusters for select
  to authenticated
  using (
    deleted_at is null
    and display_start is not null
    and exists (
      select 1 from public.messages m
      where m.id = fragment_clusters.message_id and m.deleted_at is null
    )
  );

revoke insert, update, delete on public.fragment_clusters from anon, authenticated;

alter table public.message_fragments
  add column cluster_id uuid,
  -- Кластер — только своего сообщения.
  add constraint message_fragments_cluster_fkey
    foreign key (cluster_id, message_id) references public.fragment_clusters (id, message_id)
    on delete set null (cluster_id);

create index message_fragments_cluster_id_idx
  on public.message_fragments (cluster_id)
  where cluster_id is not null;

/** Кто голосовал в кластере: реакции и комментарии человека — для `people_count`. */
create table public.fragment_cluster_voters (
  id uuid primary key default gen_random_uuid (),
  cluster_id uuid not null references public.fragment_clusters (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  votes int not null default 0 check (votes >= 0),
  created_at timestamptz not null default now(),
  constraint fragment_cluster_voters_key unique (cluster_id, user_id)
);

create index fragment_cluster_voters_user_id_idx on public.fragment_cluster_voters (user_id);

alter table public.fragment_cluster_voters enable row level security;
revoke all on public.fragment_cluster_voters from anon, authenticated;

/** Состояние модели у сообщения: счётчик взаимодействий, заявка, аренда пересчёта. */
create table public.fragment_cluster_state (
  id uuid not null default gen_random_uuid () unique,
  message_id uuid primary key references public.messages (id) on delete cascade,
  /** Реакции и комментарии к фрагментам сообщения за всё время. */
  interactions int not null default 0,
  /** На каком числе взаимодействий был снимок последнего пересчёта. */
  recomputed_interactions int not null default 0,
  model_version int,
  recomputed_at timestamptz,
  /** Заявка в очереди с этого момента; null — заявки нет. */
  queued_at timestamptz,
  /** Пересчёт идёт: чей и до какого времени. */
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fragment_cluster_state enable row level security;
revoke all on public.fragment_cluster_state from anon, authenticated;

-- Снятие чужих реакций человека в кластере ищет его живые реакции на фрагменты.
create index reactions_live_fragment_user_idx
  on public.reactions (user_id)
  where target_type = 'fragment' and deleted_at is null;

-- =============================================================================
-- Блокировки
-- =============================================================================

create function public.fragment_clusters_lock_key(target_message uuid)
returns bigint
language sql
immutable
as $$
  select hashtextextended('fragment_clusters:' || target_message::text, 0)
$$;

/** Разделяемая: всё, что меняет фрагменты сообщения. Брать до блокировки строк фрагментов. */
create function public.lock_fragment_clusters_shared(target_message uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock_shared(public.fragment_clusters_lock_key(target_message))
$$;

revoke execute on function public.lock_fragment_clusters_shared(uuid) from public, anon, authenticated;

/** Пишет пересчёт (или служебный путь) — не трогать кластеры триггерами по одному. */
create function public.fragment_clusters_writing()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('open.clusters_writer', true), '') = 'on'
$$;

-- =============================================================================
-- Заявки на пересчёт
-- =============================================================================

/**
 * Пора ли пересчитать после n-го взаимодействия: каждое, пока их не больше
 * `eagerInteractions`; дальше на порогах с удвоением (`thresholdDoublings`
 * раз: 40, 80) и затем каждые `thresholdStep` (180, 280…).
 */
create function public.fragment_cluster_recompute_due(n int, params jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  eager int := coalesce((params ->> 'eagerInteractions')::int, 20);
  doublings int := coalesce((params ->> 'thresholdDoublings')::int, 2);
  step int := greatest(1, coalesce((params ->> 'thresholdStep')::int, 100));
  t int;
begin
  if n <= eager then
    return true;
  end if;

  t := eager;

  for i in 1..doublings loop
    t := t * 2;

    if n = t then
      return true;
    end if;
  end loop;

  return n > t and (n - t) % step = 0;
end;
$$;

/** Ставит заявку, если её ещё нет (или она потерялась — старше пяти минут). */
create function public.fragment_clusters_enqueue(target_message uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed uuid;
begin
  insert into public.fragment_cluster_state (message_id, queued_at)
  values (target_message, now())
  on conflict (message_id) do update
    set queued_at = now(), updated_at = now()
    where fragment_cluster_state.queued_at is null
       or fragment_cluster_state.queued_at < now() - interval '5 minutes'
  returning message_id into claimed;

  if claimed is null then
    return false;
  end if;

  perform pgmq.send('fragment_clusters', jsonb_build_object('message_id', target_message));

  return true;
end;
$$;

revoke execute on function public.fragment_clusters_enqueue(uuid) from public, anon, authenticated;

/**
 * Взаимодействие с фрагментом сообщения (`interaction`) или событие, после
 * которого пересчёт нужен всегда (`force`: новый фрагмент без кластера,
 * правка текста, удаление сообщения). Заявки одного сообщения схлопываются.
 */
create function public.fragment_clusters_touch(target_message uuid, interaction boolean, force boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if public.fragment_clusters_writing() then
    return false;
  end if;

  insert into public.fragment_cluster_state as s (message_id, interactions)
  values (target_message, interaction::int)
  on conflict (message_id) do update
    set interactions = s.interactions + interaction::int, updated_at = now()
  returning s.interactions into n;

  if not (
    force
    or (interaction and public.fragment_cluster_recompute_due(n, (public.fragment_cluster_settings()).params))
  ) then
    return false;
  end if;

  return public.fragment_clusters_enqueue(target_message);
end;
$$;

revoke execute on function public.fragment_clusters_touch(uuid, boolean, boolean) from public, anon, authenticated;

-- =============================================================================
-- Сводные счётчики кластера
-- =============================================================================

/** Покомпонентная сумма рядов реакций: `a + sign · b`, нули и минусы выпадают. */
create function public.reaction_counts_combine(a jsonb, b jsonb, sign int)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(key, total) filter (where total > 0), '{}'::jsonb)
  from (
    select key, sum(value) as total
    from (
      select key, value::int as value from jsonb_each_text(coalesce(a, '{}'::jsonb))
      union all
      select key, value::int * sign from jsonb_each_text(coalesce(b, '{}'::jsonb))
    ) parts
    group by key
  ) sums
$$;

/** Голос человека в кластере ±1; `people_count` меняется, когда голосов стало 0 или 1. */
create function public.fragment_cluster_vote(cluster uuid, voter uuid, delta int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  votes_now int;
begin
  if cluster is null or voter is null or delta = 0 then
    return;
  end if;

  if delta > 0 then
    insert into public.fragment_cluster_voters as v (cluster_id, user_id, votes)
    values (cluster, voter, delta)
    on conflict (cluster_id, user_id) do update set votes = v.votes + delta
    returning v.votes into votes_now;

    if votes_now = delta then
      update public.fragment_clusters set people_count = people_count + 1 where id = cluster;
    end if;
  else
    update public.fragment_cluster_voters
    set votes = greatest(0, votes + delta)
    where cluster_id = cluster and user_id = voter and votes > 0
    returning votes into votes_now;

    if votes_now = 0 then
      update public.fragment_clusters set people_count = greatest(0, people_count - 1) where id = cluster;
    end if;
  end if;
end;
$$;

revoke execute on function public.fragment_cluster_vote(uuid, uuid, int) from public, anon, authenticated;

/**
 * Счётчики всех кластеров сообщения заново, из фрагментов: после записи
 * пересчёта и правки текста, где фрагменты переезжают пачкой.
 */
create function public.refresh_message_clusters(target_message uuid)
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
    select count(*)::int as people
    from public.fragment_cluster_voters v
    where v.cluster_id = base.id and v.votes > 0
  ) p on true
  where k.id = base.id
    and base.message_id = target_message
    and base.deleted_at is null;
end;
$$;

revoke execute on function public.refresh_message_clusters(uuid) from public, anon, authenticated;

/**
 * Счётчики фрагмента — в его кластер: разница старых и новых, а при смене
 * кластера — минус из прежнего и плюс в новый. Голоса людей (`people_count`)
 * ведут триггеры реакций и комментариев; фрагмент меняет кластер с голосами
 * только при записи пересчёта и правке текста — там счётчики собираются
 * заново (`refresh_message_clusters`).
 */
create function public.count_fragment_cluster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.fragment_clusters_writing() then
    return null;
  end if;

  if old.cluster_id is not distinct from new.cluster_id then
    if new.cluster_id is null
       or (old.member_reactions, old.visitor_reactions, old.reactions_count, old.comments_count)
          is not distinct from (new.member_reactions, new.visitor_reactions, new.reactions_count, new.comments_count) then
      return null;
    end if;

    update public.fragment_clusters
    set
      member_reactions = public.reaction_counts_combine(
        public.reaction_counts_combine(member_reactions, old.member_reactions, -1), new.member_reactions, 1
      ),
      visitor_reactions = public.reaction_counts_combine(
        public.reaction_counts_combine(visitor_reactions, old.visitor_reactions, -1), new.visitor_reactions, 1
      ),
      reactions_count = greatest(0, reactions_count - old.reactions_count + new.reactions_count),
      comments_count = greatest(0, comments_count - old.comments_count + new.comments_count),
      updated_at = now()
    where id = new.cluster_id;

    return null;
  end if;

  if old.cluster_id is not null then
    update public.fragment_clusters
    set
      member_reactions = public.reaction_counts_combine(member_reactions, old.member_reactions, -1),
      visitor_reactions = public.reaction_counts_combine(visitor_reactions, old.visitor_reactions, -1),
      reactions_count = greatest(0, reactions_count - old.reactions_count),
      comments_count = greatest(0, comments_count - old.comments_count),
      updated_at = now()
    where id = old.cluster_id;
  end if;

  if new.cluster_id is not null then
    update public.fragment_clusters
    set
      member_reactions = public.reaction_counts_combine(member_reactions, new.member_reactions, 1),
      visitor_reactions = public.reaction_counts_combine(visitor_reactions, new.visitor_reactions, 1),
      reactions_count = reactions_count + new.reactions_count,
      comments_count = comments_count + new.comments_count,
      updated_at = now()
    where id = new.cluster_id;
  end if;

  return null;
end;
$$;

revoke execute on function public.count_fragment_cluster() from public, anon, authenticated;

-- Имя — раньше `on_fragment_counted`: триггеры одного события идут по
-- алфавиту, кластер обновляется до строки сообщения.
create trigger on_fragment_clustered
  after update on public.message_fragments
  for each row execute function public.count_fragment_cluster();

-- =============================================================================
-- Жизнь фрагмента: сон и потеря уводят из кластера
-- =============================================================================

-- Та же функция, что в 20261022100000_message_fragments.sql, плюс кластер:
-- уснувший (счётчики дошли до нуля) и потерянный из кластера уходят.
create or replace function public.prepare_fragment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.deleted_at := now();
    new.reactions_count := 0;
    new.comments_count := 0;
    new.member_reactions := '{}'::jsonb;
    new.visitor_reactions := '{}'::jsonb;
    new.cluster_id := null;
  elsif tg_op = 'UPDATE'
     and (new.reactions_count, new.comments_count) is distinct from (old.reactions_count, old.comments_count) then
    new.deleted_at := case
      when new.reactions_count = 0 and new.comments_count = 0 then coalesce(old.deleted_at, now())
      else null
    end;

    if new.deleted_at is not null then
      new.cluster_id := null;
    end if;
  end if;

  if new.anchor_state = 'lost' then
    new.cluster_id := null;
  end if;

  return new;
end;
$$;

/**
 * Новый (или проснувшийся) фрагмент без кластера: пересекается с кластером
 * — входит в тот, с которым пересечение больше (при равенстве — в старший);
 * ни с чем не пересекается — остаётся без кластера и ставит заявку.
 */
create function public.attach_fragment(fragment uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.message_fragments;
  cluster uuid;
begin
  select * into f from public.message_fragments where id = fragment;

  if f.id is null or f.cluster_id is not null or f.anchor_state = 'lost' then
    return f.cluster_id;
  end if;

  select k.id into cluster
  from public.fragment_clusters k
  where k.message_id = f.message_id
    and k.deleted_at is null
    and k.start_offset < f.end_offset
    and k.end_offset > f.start_offset
  order by
    least(k.end_offset, f.end_offset) - greatest(k.start_offset, f.start_offset) desc,
    k.created_at,
    k.id
  limit 1;

  if cluster is not null then
    update public.message_fragments set cluster_id = cluster where id = fragment;
  else
    perform public.fragment_clusters_touch(f.message_id, false, true);
  end if;

  return cluster;
end;
$$;

revoke execute on function public.attach_fragment(uuid) from public, anon, authenticated;

-- Та же функция, что в 20261022110000_message_fragments_hardening.sql, плюс
-- разделяемая блокировка кластеров сообщения и привязка к кластеру.
create or replace function public.ensure_fragment(
  target_message uuid,
  range_start int,
  range_end int,
  range_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  m public.messages;
  existing uuid;
  context int := public.fragment_context_length();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Правка того же сообщения ждёт: смещения считаются от текста, который не
  -- поменяется до конца транзакции.
  select * into m from public.messages where id = target_message for share;

  if m.id is null or m.deleted_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if m.kind not in ('text', 'media', 'voice') or m.text is null then
    raise exception 'this message has no text to select' using errcode = '22023';
  end if;

  if range_start is null or range_end is null or range_start < 0 or range_end <= range_start
     or range_end > char_length(m.text) then
    raise exception 'fragment range is outside the text' using errcode = '22023';
  end if;

  if range_text is distinct from substr(m.text, range_start + 1, range_end - range_start) then
    raise exception 'fragment text does not match the message' using errcode = '22023';
  end if;

  perform public.lock_fragment_clusters_shared(m.id);

  -- Два вызова на один диапазон одного автора (реакция и комментарий разом)
  -- — по очереди: второй увидит строку первого.
  perform pg_advisory_xact_lock(
    hashtextextended(m.id::text || ':' || caller::text || ':' || range_start || '-' || range_end, 0)
  );

  select f.id into existing
  from public.message_fragments f
  where f.message_id = m.id
    and f.author_id = caller
    and f.start_offset = range_start
    and f.end_offset = range_end
    and f.deleted_at is null
    and f.anchor_state <> 'lost';

  if existing is not null then
    return existing;
  end if;

  -- Мой спящий на том же месте — он и проснётся: строк не прибавляется.
  select f.id into existing
  from public.message_fragments f
  where f.message_id = m.id
    and f.author_id = caller
    and f.start_offset = range_start
    and f.end_offset = range_end
    and f.exact_text = range_text
    and f.anchor_state <> 'lost'
  order by f.updated_at desc
  limit 1;

  if existing is null then
    insert into public.message_fragments (
      message_id, chat_id, author_id, start_offset, end_offset, exact_text, prefix_text,
      suffix_text, text_version
    ) values (
      m.id,
      m.chat_id,
      caller,
      range_start,
      range_end,
      range_text,
      substr(m.text, greatest(1, range_start - context + 1), least(range_start, context)),
      substr(m.text, range_end + 1, context),
      coalesce(m.edited_at, m.created_at)
    )
    returning id into existing;
  end if;

  perform public.attach_fragment(existing);

  return existing;
end;
$$;

-- =============================================================================
-- Одна реакция человека на кластер
-- =============================================================================

/**
 * Человек ставит реакцию на фрагмент кластера — его живые реакции на других
 * фрагментах того же кластера мягко снимаются обычным путём (счётчики и
 * сигналы — как при снятии). Звать до блокировки строки самого фрагмента:
 * строки всех задетых фрагментов берутся по порядку id, иначе две встречные
 * замены в одном кластере ждали бы друг друга.
 *
 * Гонка двух реакций одного человека в один кластер — по очереди, на
 * advisory-блокировке пары (кластер, человек); кластер фрагмента не меняется,
 * пока держится разделяемая блокировка сообщения.
 */
create function public.replace_cluster_reaction(fragment uuid, reactor uuid)
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

  update public.reactions set deleted_at = now() where id = any (victims);

  perform set_config('open.cluster_reaction_replaced', '', true);
end;
$$;

revoke execute on function public.replace_cluster_reaction(uuid, uuid) from public, anon, authenticated;

-- Та же функция, что в 20261022100000_message_fragments.sql, плюс фрагмент:
-- реакция, которая становится живой, сначала снимает прежнюю реакцию
-- человека в кластере (прямая вставка мимо `set_reaction` — тоже).
create or replace function public.prepare_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
  revived boolean;
  member_counts jsonb;
  visitor_counts jsonb;
  counts jsonb;
  taken int;
begin
  if tg_op = 'UPDATE' then
    if new.target_type is distinct from old.target_type or new.target_id is distinct from old.target_id then
      raise exception 'reaction target cannot change' using errcode = '42501';
    end if;

    revived := old.deleted_at is not null and new.deleted_at is null;

    if new.emoji is not distinct from old.emoji and not revived then
      new.audience := old.audience;
      new.chat_id := old.chat_id;
      return new;
    end if;
  else
    new.deleted_at := null;
    new.created_at := now();
  end if;

  select * into target from public.reaction_target(new.target_type, new.target_id);

  if target.chat_id is null or target.deleted_at is not null then
    raise exception '% not found', new.target_type using errcode = 'P0002';
  end if;

  if target.target_kind = 'forward' then
    raise exception 'forwards take no reactions: react to the originals' using errcode = '22023';
  end if;

  if target.target_kind = 'comment_forward' then
    raise exception 'forwarded comments take no reactions: react to the comment' using errcode = '22023';
  end if;

  new.chat_id := target.chat_id;
  new.updated_at := now();

  if new.target_type = 'pop' then
    new.audience := case
      when public.can_publish_in_channel(target.channel_id, new.user_id) then 'member'
      else 'visitor'
    end;
  else
    new.audience := case
      when exists (
        select 1 from public.chat_members
        where chat_id = target.chat_id and user_id = new.user_id
      ) then 'member'
      else 'visitor'
    end;
  end if;

  if new.target_type = 'message' then
    select m.member_reactions, m.visitor_reactions into member_counts, visitor_counts
    from public.messages m
    where m.id = new.target_id
    for no key update;

    counts := case when new.audience = 'member' then member_counts else visitor_counts end;
  elsif new.target_type = 'fragment' then
    if tg_op = 'INSERT' or revived then
      perform public.replace_cluster_reaction(new.target_id, new.user_id);
    end if;

    select f.member_reactions, f.visitor_reactions into member_counts, visitor_counts
    from public.message_fragments f
    where f.id = new.target_id
    for no key update;

    counts := case when new.audience = 'member' then member_counts else visitor_counts end;
  elsif new.target_type = 'comment' then
    select c.member_reactions, c.visitor_reactions into member_counts, visitor_counts
    from public.comments c
    where c.id = new.target_id
    for no key update;

    counts := public.reaction_counts_merge(member_counts, visitor_counts);
  else
    select p.reactions into counts
    from public.pops p
    where p.id = new.target_id
    for no key update;
  end if;

  if not counts ? new.emoji then
    select count(*) into taken from jsonb_object_keys(counts);

    -- Смена моей реакции: если я был единственным у прежней, её место
    -- освобождается тем же движением. У комментария и попа ряд общий.
    if tg_op = 'UPDATE' and old.deleted_at is null and old.emoji <> new.emoji
       and (new.target_type not in ('message', 'fragment') or old.audience = new.audience)
       and (counts ->> old.emoji)::int = 1 then
      taken := taken - 1;
    end if;

    if taken >= public.reaction_kinds_limit(new.target_type, new.audience) then
      raise exception 'reaction kinds limit reached'
        using errcode = 'OR001', hint = 'reaction_limit';
    end if;
  end if;

  return new;
end;
$$;

-- Та же функция, что в 20261022100000_message_fragments.sql, плюс фрагмент:
-- реакция снимает прежнюю реакцию человека в кластере до блокировки строки
-- фрагмента (порядок блокировок — в `replace_cluster_reaction`).
create or replace function public.set_reaction(target_type text, target_id uuid, reaction text)
returns table (emoji text, audience text)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  kind text := target_type;
  target uuid := target_id;
  found_target record;
  current_row public.reactions;
  dormant uuid;
  result public.reactions;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if kind is null or kind not in ('message', 'comment', 'pop', 'fragment') then
    raise exception 'reactions to % are not supported', kind using errcode = '22023';
  end if;

  if kind = 'fragment' then
    perform public.lock_fragment_clusters_shared(
      (select f.message_id from public.message_fragments f where f.id = target)
    );

    if reaction is not null then
      perform public.replace_cluster_reaction(target, caller);
    end if;
  end if;

  -- Все реакции на одну цель — по очереди, на строке цели.
  if kind = 'message' then
    perform 1 from public.messages m where m.id = target for no key update;
  elsif kind = 'comment' then
    perform 1 from public.comments c where c.id = target for no key update;
  elsif kind = 'fragment' then
    perform 1 from public.message_fragments f where f.id = target for no key update;
  else
    perform 1 from public.pops p where p.id = target for no key update;
  end if;

  select * into found_target from public.reaction_target(kind, target);

  if found_target.chat_id is null or found_target.deleted_at is not null then
    raise exception '% not found', kind using errcode = 'P0002';
  end if;

  if found_target.target_kind = 'forward' then
    raise exception 'forwards take no reactions: react to the originals' using errcode = '22023';
  end if;

  if found_target.target_kind = 'comment_forward' then
    raise exception 'forwarded comments take no reactions: react to the comment' using errcode = '22023';
  end if;

  select * into current_row
  from public.reactions r
  where r.target_type = kind and r.target_id = target and r.user_id = caller
    and r.deleted_at is null;

  if reaction is null then
    if current_row.id is not null then
      update public.reactions r set deleted_at = now() where r.id = current_row.id;
    end if;

    return;
  end if;

  if current_row.id is not null then
    if current_row.emoji = reaction then
      return query select current_row.emoji, current_row.audience;
      return;
    end if;

    update public.reactions r
    set emoji = reaction
    where r.id = current_row.id
    returning * into result;
  else
    select r.id into dormant
    from public.reactions r
    where r.target_type = kind and r.target_id = target and r.user_id = caller
    order by r.updated_at desc
    limit 1;

    if dormant is not null then
      update public.reactions r
      set emoji = reaction, deleted_at = null
      where r.id = dormant
      returning * into result;
    else
      insert into public.reactions (target_type, target_id, user_id, emoji)
      values (kind, target, caller, reaction)
      returning * into result;
    end if;
  end if;

  return query select result.emoji, result.audience;
end;
$$;

-- Та же функция, что в 20261022100000_message_fragments.sql, плюс фрагмент:
-- голос человека в кластере и счётчик взаимодействий сообщения.
create or replace function public.count_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_active boolean := tg_op <> 'INSERT' and old.deleted_at is null;
  is_active boolean := tg_op <> 'DELETE' and new.deleted_at is null;
  kind text := coalesce(new.target_type, old.target_type);
  target uuid := coalesce(new.target_id, old.target_id);
  target_chat uuid := coalesce(new.chat_id, old.chat_id);
  comment_message uuid;
  comment_pop uuid;
  fragment_message uuid;
  fragment_cluster uuid;
  pop_channel uuid;
  old_member text;
  old_visitor text;
  new_member text;
  new_visitor text;
begin
  if was_active and is_active
     and old.emoji = new.emoji and old.audience = new.audience then
    return null;
  end if;

  if was_active then
    old_member := case when old.audience = 'member' then old.emoji end;
    old_visitor := case when old.audience = 'visitor' then old.emoji end;
  end if;

  if is_active then
    new_member := case when new.audience = 'member' then new.emoji end;
    new_visitor := case when new.audience = 'visitor' then new.emoji end;
  end if;

  if kind = 'message' then
    update public.messages
    set
      member_reactions = public.reaction_counts_add(
        public.reaction_counts_add(member_reactions, old_member, -1), new_member, 1
      ),
      visitor_reactions = public.reaction_counts_add(
        public.reaction_counts_add(visitor_reactions, old_visitor, -1), new_visitor, 1
      ),
      reactions_count = greatest(0, reactions_count - was_active::int + is_active::int)
    where id = target;
  elsif kind = 'fragment' then
    -- Кластер до обновления: уснувший фрагмент из него уйдёт, а голос надо
    -- снять с того, где он был.
    select cluster_id into fragment_cluster from public.message_fragments where id = target;

    update public.message_fragments
    set
      member_reactions = public.reaction_counts_add(
        public.reaction_counts_add(member_reactions, old_member, -1), new_member, 1
      ),
      visitor_reactions = public.reaction_counts_add(
        public.reaction_counts_add(visitor_reactions, old_visitor, -1), new_visitor, 1
      ),
      reactions_count = greatest(0, reactions_count - was_active::int + is_active::int)
    where id = target
    returning message_id into fragment_message;

    if fragment_message is not null and not public.fragment_clusters_writing() then
      if was_active <> is_active then
        perform public.fragment_cluster_vote(
          fragment_cluster, coalesce(new.user_id, old.user_id), case when is_active then 1 else -1 end
        );
      end if;

      if coalesce(current_setting('open.cluster_reaction_replaced', true), '') <> 'on' then
        perform public.fragment_clusters_touch(fragment_message, true, false);
      end if;
    end if;
  elsif kind = 'comment' then
    update public.comments
    set
      member_reactions = public.reaction_counts_add(
        public.reaction_counts_add(member_reactions, old_member, -1), new_member, 1
      ),
      visitor_reactions = public.reaction_counts_add(
        public.reaction_counts_add(visitor_reactions, old_visitor, -1), new_visitor, 1
      ),
      reactions_count = greatest(0, reactions_count - was_active::int + is_active::int)
    where id = target
    returning message_id, pop_id into comment_message, comment_pop;
  elsif kind = 'pop' then
    if was_active and is_active and old.emoji = new.emoji then
      return null;
    end if;

    update public.pops
    set
      reactions = public.reaction_counts_add(
        public.reaction_counts_add(
          reactions, case when was_active then old.emoji end, -1
        ),
        case when is_active then new.emoji end,
        1
      ),
      reactions_count = greatest(0, reactions_count - was_active::int + is_active::int)
    where id = target
    returning channel_id into pop_channel;
  else
    return null;
  end if;

  -- Payload — сигнал: счётчики клиент перечитывает из базы, пачкой.
  begin
    if kind = 'message' then
      perform realtime.send(
        jsonb_build_object('chat_id', target_chat, 'message_id', target),
        'reactions_changed',
        'chat:' || target_chat::text,
        true
      );
    elsif kind = 'fragment' and fragment_message is not null then
      perform realtime.send(
        jsonb_build_object('message_id', fragment_message, 'fragment_id', target),
        'fragment_reactions_changed',
        'comments:' || fragment_message::text,
        true
      );
    elsif kind = 'comment' and coalesce(comment_message, comment_pop) is not null then
      perform realtime.send(
        jsonb_build_object('message_id', comment_message, 'pop_id', comment_pop, 'comment_id', target),
        'comment_reactions_changed',
        'comments:' || coalesce(comment_message, comment_pop)::text,
        true
      );
    elsif kind = 'pop' and pop_channel is not null then
      perform realtime.send(
        jsonb_build_object('channel_id', pop_channel, 'pop_id', target),
        'pop_reactions_changed',
        'pops:' || pop_channel::text,
        true
      );
    end if;
  exception
    when others then null;
  end;

  return null;
end;
$$;

-- =============================================================================
-- Комментарии к фрагменту
-- =============================================================================

-- Та же функция, что в 20261022100000_message_fragments.sql, плюс фрагмент:
-- разделяемая блокировка кластеров до строки фрагмента, голос автора в
-- кластере и счётчик взаимодействий сообщения.
create or replace function public.handle_comment_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  delta int := 0;
  event text;
  target uuid := coalesce(new.message_id, new.pop_id);
  pop_channel uuid;
  fragment_cluster uuid;
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then
      delta := 1;
      event := 'comment_added';
    end if;
  elsif old.deleted_at is null and new.deleted_at is not null then
    delta := -1;
    event := 'comment_deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    delta := 1;
    event := 'comment_added';
  elsif new.deleted_at is null and new.edited_at is distinct from old.edited_at then
    event := 'comment_edited';
  end if;

  if event is null then
    return null;
  end if;

  if delta <> 0 then
    if new.pop_id is not null then
      update public.pops
      set comments_count = greatest(0, comments_count + delta)
      where id = new.pop_id
      returning channel_id into pop_channel;
    else
      update public.messages
      set comments_count = greatest(0, comments_count + delta)
      where id = new.message_id;
    end if;

    if new.fragment_id is not null then
      perform public.lock_fragment_clusters_shared(new.message_id);

      select cluster_id into fragment_cluster from public.message_fragments where id = new.fragment_id;

      update public.message_fragments
      set comments_count = greatest(0, comments_count + delta)
      where id = new.fragment_id;

      if not public.fragment_clusters_writing() then
        perform public.fragment_cluster_vote(fragment_cluster, new.author_id, delta);
        perform public.fragment_clusters_touch(new.message_id, true, false);
      end if;
    end if;

    if new.thread_root_id is not null then
      update public.comments
      set replies_count = greatest(0, replies_count + delta)
      where id = new.thread_root_id;
    end if;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object(
        'message_id', new.message_id,
        'pop_id', new.pop_id,
        'comment_id', new.id,
        'thread_root_id', new.thread_root_id,
        'fragment_id', new.fragment_id
      ),
      event,
      'comments:' || target::text,
      true
    );

    if delta <> 0 and new.pop_id is not null then
      perform realtime.send(
        jsonb_build_object('channel_id', pop_channel, 'pop_id', new.pop_id),
        'pop_comments_changed',
        'pops:' || pop_channel::text,
        true
      );
    elsif delta <> 0 then
      perform realtime.send(
        jsonb_build_object('chat_id', new.chat_id, 'message_id', new.message_id),
        'comments_changed',
        'chat:' || new.chat_id::text,
        true
      );
    end if;
  exception
    when others then null;
  end;

  return null;
end;
$$;

-- =============================================================================
-- Правка и удаление сообщения
-- =============================================================================

/**
 * Та же логика, что в 20261022110000_message_fragments_hardening.sql, плюс
 * кластеры: переехавшие фрагменты остаются в своих кластерах, потерянные
 * уходят. Диапазоны кластеров — от прежнего текста, поэтому до пересчёта
 * (заявка ставится сразу) на тексте они не показываются.
 */
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

  delete from fragment_rebind_plan;
  delete from fragment_rebind_clusters;

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

/** Удалённое сообщение: кластеры прячет политика сразу, запись пересчёта их гасит. */
create function public.handle_message_deleted_for_clusters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.fragment_clusters k
    where k.message_id = new.id and k.deleted_at is null
  ) then
    perform public.fragment_clusters_touch(new.id, false, true);
  end if;

  return null;
end;
$$;

revoke execute on function public.handle_message_deleted_for_clusters() from public, anon, authenticated;

create trigger on_message_deleted_for_clusters
  after update of deleted_at on public.messages
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.handle_message_deleted_for_clusters();

-- =============================================================================
-- Обработчик: снимок, запись результата, схлопывание реакций
-- =============================================================================

/**
 * Снимок сообщения для модели — с арендой пересчёта: пока аренда жива,
 * второй пересчёт того же сообщения не начнётся. Аренда занята — null.
 * Время голосов — микросекунды эпохи.
 */
create function public.fragment_clusters_take(target_message uuid, msg_ids bigint[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.fragment_cluster_config := public.fragment_cluster_settings();
  st public.fragment_cluster_state;
  m public.messages;
  token uuid := gen_random_uuid();
  live boolean;
begin
  select * into m from public.messages where id = target_message;

  if m.id is null then
    return jsonb_build_object('message_id', target_message, 'gone', true, 'msg_ids', to_jsonb(msg_ids));
  end if;

  insert into public.fragment_cluster_state (message_id) values (target_message)
  on conflict (message_id) do nothing;

  update public.fragment_cluster_state
  set
    lease_token = token,
    lease_until = now() + make_interval(secs => coalesce((cfg.params ->> 'leaseSeconds')::int, 30)),
    queued_at = null,
    updated_at = now()
  where message_id = target_message
    and (lease_until is null or lease_until < now())
  returning * into st;

  if st.message_id is null then
    return null;
  end if;

  live := m.deleted_at is null;

  return jsonb_build_object(
    'message_id', target_message,
    'lease', token,
    'msg_ids', to_jsonb(msg_ids),
    'interactions', st.interactions,
    'deleted', not live,
    'text_version', coalesce(m.edited_at, m.created_at),
    'text_hash', md5(coalesce(m.text, '')),
    'text', case when live then coalesce(m.text, '') else '' end,
    'model_version', cfg.version,
    'params', cfg.params,
    'fragments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'start', f.start_offset, 'end', f.end_offset, 'clusterId', f.cluster_id
      ) order by f.id), '[]'::jsonb)
      from public.message_fragments f
      where live and f.message_id = target_message and f.deleted_at is null and f.anchor_state <> 'lost'
    ),
    'votes', (
      select coalesce(jsonb_agg(v order by v ->> 'fragmentId', v ->> 'kind', v ->> 'at'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'fragmentId', f.id, 'userId', r.user_id, 'kind', 'reaction',
          'at', round(extract(epoch from r.updated_at) * 1000000)
        ) as v
        from public.message_fragments f
        join public.reactions r on r.target_type = 'fragment' and r.target_id = f.id and r.deleted_at is null
        where live and f.message_id = target_message and f.deleted_at is null and f.anchor_state <> 'lost'
        union all
        select jsonb_build_object(
          'fragmentId', f.id, 'userId', c.author_id, 'kind', 'comment',
          'at', round(extract(epoch from c.created_at) * 1000000)
        )
        from public.message_fragments f
        join public.comments c on c.fragment_id = f.id and c.deleted_at is null
        where live and f.message_id = target_message and f.deleted_at is null and f.anchor_state <> 'lost'
      ) votes
    ),
    'previous', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', k.id, 'start', k.start_offset, 'end', k.end_offset,
        'createdAt', round(extract(epoch from k.created_at) * 1000000)
      ) order by k.id), '[]'::jsonb)
      from public.fragment_clusters k
      where live and k.message_id = target_message and k.deleted_at is null
    )
  );
end;
$$;

/**
 * Пачка заявок из очереди — снимками. Заявки одного сообщения отдаются
 * вместе; сообщение, которое уже пересчитывается, возвращается в очередь
 * через пару секунд. Невидимость заявки — на время аренды: упавший
 * обработчик не теряет заявку, она вернётся сама.
 */
create function public.fragment_clusters_claim(batch int default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.fragment_cluster_config := public.fragment_cluster_settings();
  r record;
  snap jsonb;
  out jsonb := '[]'::jsonb;
begin
  for r in
    select public.uuid_or_null(q.message ->> 'message_id') as message_id, array_agg(q.msg_id order by q.msg_id) as ids
    from pgmq.read(
      'fragment_clusters',
      coalesce((cfg.params ->> 'leaseSeconds')::int, 30),
      least(greatest(coalesce(batch, 10), 1), 100)
    ) q
    group by 1
  loop
    if r.message_id is null then
      perform pgmq.delete('fragment_clusters', r.ids);
      continue;
    end if;

    snap := public.fragment_clusters_take(r.message_id, r.ids);

    if snap is null then
      perform pgmq.set_vt('fragment_clusters', id, 2) from unnest(r.ids) id;
    else
      out := out || jsonb_build_array(snap);
    end if;
  end loop;

  return out;
end;
$$;

/**
 * Результат модели — в базу одной короткой транзакцией.
 *
 * `result`: `{lease, msg_ids, interactions, text_version, text_hash,
 * model_version, clusters: [{id, start, end, popularity, display,
 * fragmentIds}]}` — что
 * отдал снимок, плюс `computeClusters`. Аренда не наша — результат
 * выбрасывается; текст правили после снимка — заявка ставится заново.
 * Фрагменты, которых снимок не видел, привязываются по правилу нового
 * фрагмента. Схлопывание реакций в слившихся кластерах — отдельной
 * транзакцией (`fragment_clusters_dedup`), чтобы запись не трогала реакции.
 */
create function public.fragment_clusters_apply(target_message uuid, result jsonb)
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

    delete from fragment_cluster_plan;
    delete from fragment_cluster_assign;

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

/**
 * После записи пересчёта: у человека в каждом кластере остаётся последняя по
 * времени реакция, остальные мягко снимаются обычным путём. Снятые не
 * возвращаются, даже если кластер потом разделится.
 */
create function public.fragment_clusters_dedup(target_message uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  victims uuid[];
begin
  perform set_config('lock_timeout', '5s', true);
  perform public.lock_fragment_clusters_shared(target_message);

  select array_agg(id) into victims
  from (
    select
      r.id,
      row_number() over (
        partition by f.cluster_id, r.user_id order by r.updated_at desc, r.id desc
      ) as n
    from public.message_fragments f
    join public.reactions r on r.target_type = 'fragment' and r.target_id = f.id and r.deleted_at is null
    where f.message_id = target_message
      and f.cluster_id is not null
      and f.deleted_at is null
      and r.user_id is not null
  ) ranked
  where n > 1;

  if victims is null then
    return 0;
  end if;

  perform 1
  from public.message_fragments f
  where f.id in (select r.target_id from public.reactions r where r.id = any (victims))
  order by f.id
  for no key update;

  perform set_config('open.cluster_reaction_replaced', 'on', true);

  update public.reactions set deleted_at = now() where id = any (victims);

  perform set_config('open.cluster_reaction_replaced', '', true);

  return cardinality(victims);
end;
$$;

revoke execute on function public.fragment_clusters_take(uuid, bigint[]) from public, anon, authenticated;
revoke execute on function public.fragment_clusters_claim(int) from public, anon, authenticated;
revoke execute on function public.fragment_clusters_apply(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.fragment_clusters_dedup(uuid) from public, anon, authenticated;

grant execute on function public.fragment_clusters_claim(int) to service_role;
grant execute on function public.fragment_clusters_apply(uuid, jsonb) to service_role;
grant execute on function public.fragment_clusters_dedup(uuid) to service_role;

-- =============================================================================
-- Будильник обработчика
-- =============================================================================

/**
 * Для pg_cron: есть видимые заявки — будит Edge Function. Адрес и секрет —
 * в Vault (`fragment_clusters_worker_url`, `fragment_clusters_worker_secret`);
 * их нет (локальная база) — молчит.
 */
create function public.fragment_clusters_kick()
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

  perform net.http_post(
    url := url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );

  return true;
end;
$$;

revoke execute on function public.fragment_clusters_kick() from public, anon, authenticated;

select cron.schedule(
  'fragment-clusters-kick',
  '2 seconds',
  $$select public.fragment_clusters_kick()$$
);
