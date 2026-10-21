-- Правки по ревью этапа 3 приватности.
--
--   1. Поиск внутри чата (`search_chat_messages`, `count_chat_search`) отдавал
--      текст непринятой заявки на диалог постороннему, знающему id чата:
--      функции с правами владельца проверяли только удаление и участие.
--   2. Автоограничение считало разные аккаунты, а не разных людей: пять
--      аккаунтов одного телефона могли ограничить кого угодно. Аккаунты одного
--      устройства теперь — один человек.
--   3. Лимит обращений к не-друзьям считается по всем аккаунтам устройства, а
--      блокировка бралась по одному аккаунту: параллельные заявки с двух
--      аккаунтов одного телефона проходили проверку разом. Ключ блокировки —
--      общий для устройства.

-- =============================================================================
-- 1. Поиск внутри чата — заявку видят только двое
-- =============================================================================

create or replace function public.search_chat_messages(
  target_chat uuid,
  query text,
  before_seq bigint default null,
  page_size int default 30
)
returns table (
  message_id uuid,
  seq bigint,
  author_id uuid,
  author_name text,
  text text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  needle text;
  tsq tsquery;
  pattern text;
  use_like boolean;
  open_chat boolean;
  visible boolean;
  lim int := least(greatest(coalesce(page_size, 30), 1), 100);
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  needle := public.search_norm(query);

  if needle is null or needle = '' then
    return;
  end if;

  select
    c.kind = 'channel_posts'
      or exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.user_id = me)
  into open_chat
  from public.chats c
  where c.id = target_chat and c.deleted_at is null
    -- Непринятую заявку на диалог видят только двое — и в поиске тоже.
    and (not c.request_pending or me = any (c.founding_member_ids));

  if open_chat is null then
    return;
  end if;

  tsq := public.search_tsquery(needle);
  pattern := public.search_like(needle);
  use_like := char_length(needle) >= 3;
  visible := public.chat_time_visible(target_chat);

  return query
  select
    m.id, m.seq, m.author_id, coalesce(p.display_name, p.username), m.text,
    case when visible then m.created_at end
  from public.messages m
  left join public.profiles p on p.id = m.author_id
  where m.chat_id = target_chat
    and m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
    and (before_seq is null or m.seq < before_seq)
    and (
      (tsq is not null and public.search_tsv(m.text) @@ tsq)
      or (use_like and public.search_norm(m.text) like pattern)
    )
    and (open_chat or public.message_found_by_author(m.chat_id, m.author_id, me))
  order by m.seq desc
  limit lim;
end;
$$;

create or replace function public.count_chat_search(target_chat uuid, query text)
returns int
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  me uuid := auth.uid();
  needle text;
  tsq tsquery;
  pattern text;
  use_like boolean;
  open_chat boolean;
  total int;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  needle := public.search_norm(query);

  if needle is null or needle = '' then
    return 0;
  end if;

  select
    c.kind = 'channel_posts'
      or exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.user_id = me)
  into open_chat
  from public.chats c
  where c.id = target_chat and c.deleted_at is null
    -- Непринятую заявку на диалог видят только двое — и в поиске тоже.
    and (not c.request_pending or me = any (c.founding_member_ids));

  if open_chat is null then
    return 0;
  end if;

  tsq := public.search_tsquery(needle);
  pattern := public.search_like(needle);
  use_like := char_length(needle) >= 3;

  select count(*) into total
  from (
    select 1
    from public.messages m
    where m.chat_id = target_chat
      and m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
      and (
        (tsq is not null and public.search_tsv(m.text) @@ tsq)
        or (use_like and public.search_norm(m.text) like pattern)
      )
      and (open_chat or public.message_found_by_author(m.chat_id, m.author_id, me))
    limit 1000
  ) hits;

  return total;
end;
$$;

-- =============================================================================
-- 2. Автоограничение — по людям, а не по аккаунтам
-- =============================================================================

/** Один представитель на устройство: наименьший id среди связанных аккаунтов. */
create function public.device_person(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select min(x::text) from public.linked_accounts(p_user) x
$$;

create or replace function public.refresh_auto_restriction(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(hours => public.safety_int('auto_restrict_window_hours'));
  n int;
begin
  if p_user is null then
    return;
  end if;

  select count(distinct public.device_person(actor)) into n
  from (
    select b.blocker_id as actor
    from public.blocks b
    where b.blocked_id = p_user and b.created_at > since
    union
    select r.reporter_id
    from public.reports r
    where r.target_user_id = p_user and r.created_at > since and r.reporter_id is not null
  ) actors;

  if n < public.safety_int('auto_restrict_actors') then
    return;
  end if;

  insert into public.account_restrictions as r (user_id, restricted_until, actors)
  values (p_user, now() + make_interval(hours => public.safety_int('auto_restrict_hours')), n)
  on conflict (user_id) do update
    set restricted_until = greatest(
          r.restricted_until,
          now() + make_interval(hours => public.safety_int('auto_restrict_hours'))
        ),
        actors = excluded.actors,
        updated_at = now();
end;
$$;

-- =============================================================================
-- 3. Лимит обращений — под общей блокировкой устройства
-- =============================================================================

create or replace function public.check_contact_request_limit(p_user uuid, p_count int)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if coalesce(p_count, 0) <= 0 then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('contact_requests_of:' || public.device_person(p_user), 0)
  );

  if (
    select count(*) from public.contact_request_log l
    where l.requester_id in (select public.linked_accounts(p_user))
      and l.created_at > now() - interval '1 day'
  ) + p_count > public.safety_int('contact_requests_per_day') then
    raise exception 'Слишком много заявок незнакомым людям, попробуйте завтра' using errcode = 'OPN10';
  end if;
end;
$$;

revoke execute on function public.device_person(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_auto_restriction(uuid) from public, anon, authenticated;
revoke execute on function public.check_contact_request_limit(uuid, int) from public, anon, authenticated;
