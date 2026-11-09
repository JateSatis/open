-- A result type without stored state. PostgREST embeds history_window_messages
-- with the existing MESSAGE_COLUMNS, including complete forward islands.
create or replace view public.history_window_rows with (security_invoker = true) as
select null::uuid as chat_id, null::text as target_status,
  null::uuid as anchor_id, null::bigint as anchor_seq,
  null::bigint as before_seq, null::bigint as after_seq,
  false as has_before, false as has_after,
  null::bigint as lower_seq, false as lower_inclusive,
  null::bigint as upper_seq, false as upper_inclusive,
  null::uuid[] as message_ids
where false;
grant select on public.history_window_rows to authenticated;

-- SECURITY INVOKER is intentional: no new path to raw messages or nested data.
-- message_rows is the existing viewer-aware security boundary. STABLE keeps
-- every internal SELECT and the PostgREST embeddings on the calling snapshot.
create or replace function public.get_history_window(
  p_chat uuid, p_mode text, p_limit integer default 30,
  p_target uuid default null, p_hint_seq bigint default null,
  p_cursor jsonb default null
)
returns setof public.history_window_rows
language plpgsql stable security invoker
set search_path = public
rows 1
as $$
declare
  r public.history_window_rows;
  position bigint;
  pivot bigint;
  take_before integer;
  center_count integer;
  left_ids uuid[] := '{}';
  right_ids uuid[] := '{}';
  first_seq bigint;
  last_seq bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_chat is null or p_mode is null or p_mode not in ('latest', 'around', 'before', 'after')
    or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid history request (limit: 1..100)' using errcode = '22023';
  end if;
  if (p_mode = 'around' and (p_target is null or p_cursor is not null))
    or (p_mode <> 'around' and (p_target is not null or p_hint_seq is not null))
    or (p_mode in ('before', 'after') and p_cursor is null)
    or (p_mode = 'latest' and p_cursor is not null)
    or (p_hint_seq is not null and (p_hint_seq < 1 or p_hint_seq > 9007199254740991)) then
    raise exception 'Conflicting history parameters' using errcode = '22023';
  end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'object'
      or not (p_cursor ?& array['chatId', 'direction', 'seq'])
      or (p_cursor - array['chatId', 'direction', 'seq']) <> '{}'::jsonb
      or p_cursor->>'chatId' is distinct from p_chat::text
      or p_cursor->>'direction' is distinct from p_mode
      or jsonb_typeof(p_cursor->'seq') is distinct from 'number'
      or (p_cursor->>'seq') !~ '^[0-9]{1,16}$' then
      raise exception 'Invalid history cursor' using errcode = '22023';
    end if;
    position := (p_cursor->>'seq')::bigint;
    if position > 9007199254740991 or (p_mode = 'after' and position = 9007199254740991) then
      raise exception 'Unsafe history position' using errcode = '22023';
    end if;
  end if;

  r.chat_id := p_chat;
  r.target_status := 'none';
  r.message_ids := '{}';
  r.has_before := false;
  r.has_after := false;
  r.lower_inclusive := false;
  r.upper_inclusive := false;

  if p_mode = 'around' then
    -- Never resolve the target through raw messages, another chat, or a hidden
    -- placeholder. Its existence and server seq are otherwise not disclosed.
    select m.id, m.seq into r.anchor_id, pivot
      from public.message_rows m
      where m.chat_id = p_chat and m.id = p_target and not m.hidden;
    if pivot is not null then
      r.target_status := 'found';
    elsif p_hint_seq is null then
      r.target_status := 'unavailable';
      return next r;
      return;
    else
      r.target_status := 'substituted';
      select m.id, m.seq into r.anchor_id, pivot
        from public.message_rows m
        where m.chat_id = p_chat and m.seq >= p_hint_seq and not m.hidden
        order by m.seq limit 1;
      if pivot is null then
        select m.id, m.seq into r.anchor_id, pivot
          from public.message_rows m
          where m.chat_id = p_chat and m.seq < p_hint_seq and not m.hidden
          order by m.seq desc limit 1;
      end if;
      if pivot is null then r.target_status := 'empty'; end if;
    end if;
    r.anchor_seq := pivot;
    -- If only hidden placeholders remain, still check their interval without
    -- claiming that any of them is an available replacement target.
    center_count := case when r.anchor_id is null then 0 else 1 end;
    pivot := coalesce(pivot, p_hint_seq);
    take_before := (p_limit - center_count) / 2;
    select coalesce(array_agg(x.id order by x.seq), '{}') into left_ids from (
      select m.id, m.seq from public.message_rows m
      where m.chat_id = p_chat and (m.seq < pivot or (center_count = 0 and m.seq = pivot))
      order by m.seq desc limit take_before
    ) x;
    select coalesce(array_agg(x.id order by x.seq), '{}') into right_ids from (
      select m.id, m.seq from public.message_rows m
      where m.chat_id = p_chat and m.seq > pivot
      order by m.seq limit p_limit - center_count - cardinality(left_ids)
    ) x;
    -- At the current end, spend unused right-hand capacity on the left.
    if cardinality(right_ids) < p_limit - center_count - cardinality(left_ids) then
      select coalesce(array_agg(x.id order by x.seq), '{}') into left_ids from (
        select m.id, m.seq from public.message_rows m
        where m.chat_id = p_chat and (m.seq < pivot or (center_count = 0 and m.seq = pivot))
        order by m.seq desc limit p_limit - center_count - cardinality(right_ids)
      ) x;
    end if;
    r.message_ids := left_ids || case when center_count = 0 then '{}'::uuid[] else array[r.anchor_id] end || right_ids;
  elsif p_mode in ('latest', 'before') then
    select coalesce(array_agg(x.id order by x.seq), '{}') into r.message_ids from (
      select m.id, m.seq from public.message_rows m
      where m.chat_id = p_chat and (position is null or m.seq < position)
      order by m.seq desc limit p_limit
    ) x;
  else
    select coalesce(array_agg(x.id order by x.seq), '{}') into r.message_ids from (
      select m.id, m.seq from public.message_rows m
      where m.chat_id = p_chat and m.seq > position
      order by m.seq limit p_limit
    ) x;
  end if;

  select min(m.seq), max(m.seq) into first_seq, last_seq
    from public.message_rows m where m.chat_id = p_chat and m.id = any(r.message_ids);
  -- Empty directional pages verify the whole requested half-line. Reverse
  -- continuation includes the input boundary (it was not returned on this page).
  r.before_seq := coalesce(first_seq, case when p_mode = 'after' then position + 1 end);
  r.after_seq := coalesce(last_seq, case when p_mode = 'before' then greatest(0, position - 1) end);
  select exists(select 1 from public.message_rows m where m.chat_id = p_chat and m.seq < r.before_seq),
         exists(select 1 from public.message_rows m where m.chat_id = p_chat and m.seq > r.after_seq)
    into r.has_before, r.has_after;
  r.lower_seq := case when r.has_before then first_seq end;
  r.upper_seq := case when r.has_after then last_seq end;
  r.lower_inclusive := r.lower_seq is not null;
  r.upper_inclusive := r.upper_seq is not null;
  if p_mode = 'before' then r.upper_seq := position; r.upper_inclusive := false; end if;
  if p_mode = 'after' then r.lower_seq := position; r.lower_inclusive := false; end if;
  if not r.has_before then r.before_seq := null; end if;
  if not r.has_after then r.after_seq := null; end if;
  if greatest(first_seq, last_seq, r.before_seq, r.after_seq) > 9007199254740991 then
    raise exception 'Unsafe history position' using errcode = '22023';
  end if;
  return next r;
end;
$$;

create or replace function public.history_window_messages(public.history_window_rows)
returns setof public.message_rows
language sql stable security invoker
set search_path = public
as $$
  select m.* from public.message_rows m
  where m.chat_id = $1.chat_id and m.id = any($1.message_ids)
  order by m.seq limit 100
$$;

revoke all on function public.get_history_window(uuid, text, integer, uuid, bigint, jsonb) from public, anon;
revoke all on function public.history_window_messages(public.history_window_rows) from public, anon;
grant execute on function public.get_history_window(uuid, text, integer, uuid, bigint, jsonb) to authenticated;
grant execute on function public.history_window_messages(public.history_window_rows) to authenticated;
