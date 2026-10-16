-- Кластеры фрагментов, этап 3а: события людей с кластерами — данные для
-- обучения модели.
--
-- Что люди сделали с тем, что им показали: показ отображаемых кластеров,
-- открытие панели кластера, реакция и комментарий из неё, панель по
-- выделенной области, переход по цитате фрагмента к куску. Каждое событие
-- ссылается на снимок решения (`fragment_cluster_decisions`), по которому
-- кластеры были показаны. Клиент пишет пачкой через
-- `record_fragment_cluster_events` — только от своего имени, с лимитом
-- пачки и частоты; повторный показ того же снимка в окне не дублируется.
--
-- Серверное событие без клиента: новый фрагмент (первая реакция или первый
-- комментарий к куску) — внутри отображаемого кластера, частично или вне его.
-- Это самый ценный сигнал: что люди считают важным, видя нашу подсветку.
--
-- Ретенция — та же, что у журнала решений.

create table public.fragment_cluster_events (
  id uuid primary key default gen_random_uuid (),
  user_id uuid references public.profiles (id) on delete set null,
  message_id uuid not null references public.messages (id) on delete cascade,
  decision_id uuid references public.fragment_cluster_decisions (id) on delete set null,
  cluster_id uuid references public.fragment_clusters (id) on delete set null,
  fragment_id uuid references public.message_fragments (id) on delete set null,
  kind text not null,
  /** Диапазон, code points: выделенная область, фрагмент, кусок цитаты. */
  range_start int,
  range_end int,
  /** Только у `fragment_created`: где родился фрагмент относительно подсветки. */
  placement text,
  /** Числа события (сколько кластеров показано, пересечение и т. п.). */
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fragment_cluster_events_kind check (kind in (
    'clusters_shown',
    'cluster_opened',
    'cluster_reacted',
    'cluster_commented',
    'area_opened',
    'quote_followed',
    'fragment_created'
  )),
  constraint fragment_cluster_events_placement check (
    (kind = 'fragment_created') = (placement is not null)
    and (placement is null or placement in ('inside', 'partial', 'outside'))
  ),
  constraint fragment_cluster_events_range check (
    (range_start is null and range_end is null) or (range_start >= 0 and range_end > range_start)
  ),
  constraint fragment_cluster_events_detail_object check (jsonb_typeof(detail) = 'object')
);

comment on table public.fragment_cluster_events is
  'События людей с кластерами фрагментов — данные для обучения модели кластеров, пользователям закрыта.';

create index fragment_cluster_events_created_at_idx on public.fragment_cluster_events (created_at);

create index fragment_cluster_events_decision_id_idx
  on public.fragment_cluster_events (decision_id)
  where decision_id is not null;

-- Частота на человека и повтор показа.
create index fragment_cluster_events_user_idx on public.fragment_cluster_events (user_id, created_at);

alter table public.fragment_cluster_events enable row level security;
revoke all on public.fragment_cluster_events from anon, authenticated;

-- =============================================================================
-- Запись событий клиента
-- =============================================================================

/**
 * Пачка событий текущего пользователя:
 * `[{kind, message_id, decision_id?, cluster_id?, fragment_id?, range_start?,
 * range_end?, detail?}]`. Пачка больше `eventsBatchMax` или чаще
 * `eventsPerMinute` событий в минуту — отказ. Ссылки, не принадлежащие
 * сообщению, обнуляются; событие о сообщении, которого нет, пропускается.
 * Показ того же снимка тем же человеком — не чаще раза в `shownDedupSeconds`.
 * Отдаёт, сколько событий записано.
 */
create function public.record_fragment_cluster_events(events jsonb)
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

  select count(*) into recent
  from public.fragment_cluster_events
  where user_id = caller and created_at > now() - interval '1 minute';

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

    rs := case when jsonb_typeof(e -> 'range_start') = 'number' then (e ->> 'range_start')::numeric::int end;
    re := case when jsonb_typeof(e -> 'range_end') = 'number' then (e ->> 'range_end')::numeric::int end;

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

revoke execute on function public.record_fragment_cluster_events(jsonb) from public, anon;
grant execute on function public.record_fragment_cluster_events(jsonb) to authenticated;

-- =============================================================================
-- Серверное событие: новый фрагмент относительно подсветки
-- =============================================================================

/**
 * Где родился фрагмент относительно отображаемых сейчас кластеров: целиком
 * внутри одного (`inside`), пересекает (`partial`) или вне всех (`outside`).
 * Кластер — отображаемый с наибольшим пересечением; снимок — тот, по
 * которому кластеры показаны.
 */
create function public.log_fragment_created(fragment uuid, actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.message_fragments;
  best record;
  shown int;
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
    least(k.display_end, f.end_offset) - greatest(k.display_start, f.start_offset) as overlap
  into best
  from public.fragment_clusters k
  where k.message_id = f.message_id
    and k.deleted_at is null
    and k.display_start is not null
  order by
    least(k.display_end, f.end_offset) - greatest(k.display_start, f.start_offset) desc,
    k.display_start
  limit 1;

  select count(*) into shown
  from public.fragment_clusters k
  where k.message_id = f.message_id and k.deleted_at is null and k.display_start is not null;

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
      'shown', shown
    )
  );
end;
$$;

revoke execute on function public.log_fragment_created(uuid, uuid) from public, anon, authenticated;

-- Та же функция, что в 20261023100000_fragment_clusters.sql, плюс серверное
-- событие, когда фрагмент рождается или просыпается.
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

  -- Место — до привязки: привязка не меняет подсветку, но событие должно
  -- видеть ровно то, что было на экране в момент выделения.
  perform public.log_fragment_created(existing, caller);
  perform public.attach_fragment(existing);

  return existing;
end;
$$;

-- =============================================================================
-- Ретенция: события — вместе с журналом решений
-- =============================================================================

-- Та же функция, что в 20261024100000_fragment_cluster_decisions.sql, плюс
-- события старше срока.
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
    and not exists (select 1 from public.fragment_clusters k where k.decision_id = d.id)
    and not exists (select 1 from public.fragment_cluster_state s where s.decision_id = d.id);

  get diagnostics removed = row_count;

  return removed + events_removed;
end;
$$;
