-- Кластеры фрагментов, этап 3а: журнал решений модели — данные для обучения.
--
-- Модель (supabase/functions/_shared/fragmentClusters.ts) вместе с кластерами
-- отдаёт снимок решения: характеристики сообщения, веса функции оценки,
-- впадины рельефа, лучшие варианты подсветки по бассейнам с признаками и
-- оценками и что выбрано к показу. `fragment_clusters_apply` пишет его в
-- закрытую таблицу той же транзакцией, что и кластеры. Текста сообщения в
-- журнале нет — только смещения и числа.
--
-- Объём: новый снимок — только когда сменился отображаемый набор (или
-- каждые `decisionEvery` пересчётов). У отображаемых кластеров — id снимка,
-- по которому их показали; клиент получает его в `list_message_clusters`,
-- чтобы события людей ссылались на то, что им реально показали.
--
-- Ретенция — `historyRetentionDays` действующей конфигурации, очистка pg_cron
-- раз в сутки. Снимок, по которому кластеры показываются сейчас, не удаляется.

-- =============================================================================
-- Журнал
-- =============================================================================

create table public.fragment_cluster_decisions (
  id uuid primary key default gen_random_uuid (),
  message_id uuid not null references public.messages (id) on delete cascade,
  /** Версия конфигурации, которой посчитано. */
  model_version int not null,
  /** Функция оценки (`ScoringModel.id`). */
  scorer text,
  /** Сколько взаимодействий было у сообщения в снимке. */
  interactions int not null default 0,
  /** Решение модели (`ModelDecision`): контекст, веса, впадины, кандидаты, выбранное. */
  decision jsonb not null,
  /** Что показали на деле: отображаемые кластеры после записи — id и диапазоны. */
  displayed jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint fragment_cluster_decisions_decision_object check (jsonb_typeof(decision) = 'object'),
  constraint fragment_cluster_decisions_displayed_array check (jsonb_typeof(displayed) = 'array')
);

comment on table public.fragment_cluster_decisions is
  'Журнал решений модели кластеров — данные для обучения. Пишет только fragment_clusters_apply, пользователям закрыта.';

create index fragment_cluster_decisions_message_idx
  on public.fragment_cluster_decisions (message_id, created_at desc);

create index fragment_cluster_decisions_created_at_idx
  on public.fragment_cluster_decisions (created_at);

alter table public.fragment_cluster_decisions enable row level security;
revoke all on public.fragment_cluster_decisions from anon, authenticated;

alter table public.fragment_clusters
  /** Снимок решения, по которому кластер сейчас показан. */
  add column decision_id uuid references public.fragment_cluster_decisions (id) on delete set null;

create index fragment_clusters_decision_id_idx
  on public.fragment_clusters (decision_id)
  where decision_id is not null;

alter table public.fragment_cluster_state
  /** Последний записанный снимок решения сообщения. */
  add column decision_id uuid references public.fragment_cluster_decisions (id) on delete set null,
  /** Пересчётов подряд без нового снимка: набор не менялся. */
  add column decisions_skipped int not null default 0;

-- =============================================================================
-- Снимок: прежнее отображаемое — для признака «уже показывался»
-- =============================================================================

-- Та же функция, что в 20261023100000_fragment_clusters.sql, плюс прежние
-- отображаемые диапазоны в `previous`.
create or replace function public.fragment_clusters_take(target_message uuid, msg_ids bigint[])
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
        'createdAt', round(extract(epoch from k.created_at) * 1000000),
        'displayStart', k.display_start, 'displayEnd', k.display_end
      ) order by k.id), '[]'::jsonb)
      from public.fragment_clusters k
      where live and k.message_id = target_message and k.deleted_at is null
    )
  );
end;
$$;

-- =============================================================================
-- Запись результата со снимком решения
-- =============================================================================

-- Та же функция, что в 20261023120000_fragment_plans_truncate.sql, плюс
-- снимок решения (`result.decision`) в журнал и его id у кластеров.
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
    if decision_now is null
       or before_display is distinct from after_display
       or skipped + 1 >= greatest(1, coalesce((cfg.params ->> 'decisionEvery')::int, 20)) then
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

    update public.fragment_clusters k
    set decision_id = decision_now
    where k.message_id = target_message
      and k.deleted_at is null
      and k.decision_id is distinct from decision_now;
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

-- =============================================================================
-- Чтение: id снимка, по которому кластеры показаны
-- =============================================================================

-- Та же функция, что в 20261023130000_fragment_cluster_reads.sql, плюс
-- `decision_id`: события людей ссылаются на то, что им показали.
drop function public.list_message_clusters(uuid);

create function public.list_message_clusters(target_message uuid)
returns table (
  id uuid,
  message_id uuid,
  start_offset int,
  end_offset int,
  display_start int,
  display_end int,
  display_text text,
  popularity double precision,
  member_reactions jsonb,
  visitor_reactions jsonb,
  reactions_count int,
  comments_count int,
  people_count int,
  fragments_count int,
  my_emoji text,
  my_fragment_id uuid,
  decision_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    k.id, k.message_id, k.start_offset, k.end_offset, k.display_start, k.display_end,
    substr(m.text, k.display_start + 1, k.display_end - k.display_start),
    k.popularity, k.member_reactions, k.visitor_reactions, k.reactions_count, k.comments_count,
    k.people_count,
    (
      select count(*)::int from public.message_fragments f
      where f.cluster_id = k.id and f.deleted_at is null
    ),
    mine.emoji,
    mine.target_id,
    k.decision_id
  from public.fragment_clusters k
  join public.messages m on m.id = k.message_id
  left join lateral (
    select r.emoji, r.target_id
    from public.reactions r
    join public.message_fragments f on f.id = r.target_id
    where r.target_type = 'fragment'
      and r.user_id = auth.uid()
      and r.deleted_at is null
      and f.cluster_id = k.id
    order by r.updated_at desc
    limit 1
  ) mine on true
  where k.message_id = target_message
  order by k.display_start
$$;

revoke execute on function public.list_message_clusters(uuid) from public, anon;
grant execute on function public.list_message_clusters(uuid) to authenticated;

-- =============================================================================
-- Ретенция
-- =============================================================================

/**
 * Удаляет снимки решений старше `historyRetentionDays` (180 по умолчанию),
 * кроме тех, по которым кластеры показаны сейчас. Журнал — служебные данные,
 * не публичный контент: строки удаляются физически.
 */
create function public.fragment_cluster_history_cleanup()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  days int := greatest(1, coalesce(((public.fragment_cluster_settings()).params ->> 'historyRetentionDays')::int, 180));
  removed int;
begin
  delete from public.fragment_cluster_decisions d
  where d.created_at < now() - make_interval(days => days)
    and not exists (select 1 from public.fragment_clusters k where k.decision_id = d.id)
    and not exists (select 1 from public.fragment_cluster_state s where s.decision_id = d.id);

  get diagnostics removed = row_count;

  return removed;
end;
$$;

revoke execute on function public.fragment_cluster_history_cleanup() from public, anon, authenticated;

select cron.schedule(
  'fragment-cluster-history-cleanup',
  '17 3 * * *',
  $$select public.fragment_cluster_history_cleanup()$$
);
