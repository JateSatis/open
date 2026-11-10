-- Coordinates are (parent seq, original forward_items.position). No renumbering,
-- copies of original content, or extra send events. Old message APIs remain valid.
create view public.history_element_rows with (security_invoker = true) as
select coalesce(i.id, m.id) as id, m.id as message_id, m.chat_id, m.seq,
  coalesce(i.position, 0) as position, i.id as forward_item_id, m.hidden
from public.message_rows m
left join public.forward_items i on i.forward_id = m.id and m.kind = 'forward' and not m.hidden;
grant select on public.history_element_rows to authenticated;

create view public.history_element_windows with (security_invoker = true) as
select null::uuid as chat_id, null::text as target_status, null::jsonb as anchor,
  null::jsonb as before_cursor, null::jsonb as after_cursor,
  false as has_before, false as has_after, null::jsonb as coverage,
  null::uuid[] as element_ids where false;
grant select on public.history_element_windows to authenticated;

create function public.get_history_element_window(
  p_chat uuid, p_mode text, p_limit integer default 30,
  p_target uuid default null, p_hint_seq bigint default null,
  p_cursor jsonb default null, p_target_item uuid default null,
  p_hint_position integer default 0
)
returns setof public.history_element_windows
language plpgsql stable security invoker set search_path = public rows 1
as $$
declare
  r public.history_element_windows;
  cursor_seq bigint; cursor_pos integer;
  pivot public.history_element_rows;
  first_item public.history_element_rows; last_item public.history_element_rows;
  left_ids uuid[] := '{}'; right_ids uuid[] := '{}';
  center_count integer; take_before integer;
  lower_bound jsonb; upper_bound jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_chat is null or p_mode is null or p_mode not in ('latest','around','before','after')
    or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid history request' using errcode = '22023';
  end if;
  if (p_mode = 'around' and (p_target is null or p_cursor is not null))
    or (p_mode <> 'around' and (p_target is not null or p_target_item is not null or p_hint_seq is not null))
    or (p_mode in ('before','after') and p_cursor is null)
    or (p_mode = 'latest' and p_cursor is not null)
    or (p_hint_seq is not null and (p_hint_seq < 1 or p_hint_seq > 9007199254740991))
    or p_hint_position is null or p_hint_position < 0 or p_hint_position > 99 then
    raise exception 'Conflicting history parameters' using errcode = '22023';
  end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'object'
      or not (p_cursor ?& array['chatId','direction','seq','position'])
      or (p_cursor - array['chatId','direction','seq','position']) <> '{}'::jsonb
      or p_cursor->>'chatId' is distinct from p_chat::text
      or p_cursor->>'direction' is distinct from p_mode
      or jsonb_typeof(p_cursor->'seq') is distinct from 'number'
      or (p_cursor->>'seq') !~ '^[0-9]{1,16}$'
      or jsonb_typeof(p_cursor->'position') is distinct from 'number'
      or (p_cursor->>'position') !~ '^(-1|[0-9]{1,3})$' then
      raise exception 'Invalid history cursor' using errcode = '22023';
    end if;
    cursor_seq := (p_cursor->>'seq')::bigint;
    cursor_pos := (p_cursor->>'position')::integer;
    if cursor_seq > 9007199254740991 or cursor_pos > 100 then
      raise exception 'Unsafe history position' using errcode = '22023';
    end if;
  end if;
  r.chat_id := p_chat; r.target_status := 'none'; r.element_ids := '{}';
  r.has_before := false; r.has_after := false;
  if p_mode = 'around' then
    -- A legacy link resolves to the first currently available element. An exact
    -- element never silently resolves to another occurrence of its original.
    select e.* into pivot from public.history_element_rows e
      where e.chat_id = p_chat and e.message_id = p_target and not e.hidden
        and (p_target_item is null or e.forward_item_id = p_target_item)
      order by e.seq, e.position limit 1;
    if pivot.id is not null then r.target_status := 'found';
    elsif p_hint_seq is null then
      r.target_status := 'unavailable'; return next r; return;
    else
      r.target_status := 'substituted';
      select e.* into pivot from public.history_element_rows e
        where e.chat_id = p_chat and not e.hidden
          and (e.seq,e.position) >= (p_hint_seq,p_hint_position)
        order by e.seq,e.position limit 1;
      if pivot.id is null then
        select e.* into pivot from public.history_element_rows e
          where e.chat_id = p_chat and not e.hidden
            and (e.seq,e.position) < (p_hint_seq,p_hint_position)
          order by e.seq desc,e.position desc limit 1;
      end if;
      if pivot.id is null then r.target_status := 'empty'; end if;
    end if;
    center_count := case when pivot.id is null then 0 else 1 end;
    if pivot.id is not null then
      r.anchor := jsonb_build_object('messageId',pivot.message_id,'itemId',pivot.forward_item_id,
        'key',pivot.id,'seq',pivot.seq,'position',pivot.position);
    else pivot.seq := p_hint_seq; pivot.position := p_hint_position;
    end if;
    take_before := (p_limit-center_count)/2;
    select coalesce(array_agg(x.id order by x.seq,x.position),'{}') into left_ids from (
      select e.id,e.seq,e.position from public.history_element_rows e where e.chat_id=p_chat
        and ((e.seq,e.position)<(pivot.seq,pivot.position)
          or (center_count=0 and (e.seq,e.position)=(pivot.seq,pivot.position)))
      order by e.seq desc,e.position desc limit take_before
    )x;
    select coalesce(array_agg(x.id order by x.seq,x.position),'{}') into right_ids from (
      select e.id,e.seq,e.position from public.history_element_rows e where e.chat_id=p_chat
        and (e.seq,e.position)>(pivot.seq,pivot.position)
      order by e.seq,e.position limit p_limit-center_count-cardinality(left_ids)
    )x;
    if cardinality(right_ids)<p_limit-center_count-cardinality(left_ids) then
      select coalesce(array_agg(x.id order by x.seq,x.position),'{}') into left_ids from (
        select e.id,e.seq,e.position from public.history_element_rows e where e.chat_id=p_chat
          and ((e.seq,e.position)<(pivot.seq,pivot.position)
            or (center_count=0 and (e.seq,e.position)=(pivot.seq,pivot.position)))
        order by e.seq desc,e.position desc limit p_limit-center_count-cardinality(right_ids)
      )x;
    end if;
    r.element_ids := left_ids || case when center_count=0 then '{}'::uuid[] else array[pivot.id] end || right_ids;
  elsif p_mode in ('latest','before') then
    select coalesce(array_agg(x.id order by x.seq,x.position),'{}') into r.element_ids from (
      select e.id,e.seq,e.position from public.history_element_rows e where e.chat_id=p_chat
        and (cursor_seq is null or (e.seq,e.position)<(cursor_seq,cursor_pos))
      order by e.seq desc,e.position desc limit p_limit
    )x;
  else
    select coalesce(array_agg(x.id order by x.seq,x.position),'{}') into r.element_ids from (
      select e.id,e.seq,e.position from public.history_element_rows e where e.chat_id=p_chat
        and (e.seq,e.position)>(cursor_seq,cursor_pos)
      order by e.seq,e.position limit p_limit
    )x;
  end if;
  select e.* into first_item from public.history_element_rows e
    where e.chat_id=p_chat and e.id=r.element_ids[1];
  select e.* into last_item from public.history_element_rows e
    where e.chat_id=p_chat and e.id=r.element_ids[cardinality(r.element_ids)];
  if first_item.id is not null then
    r.before_cursor := jsonb_build_object('chatId',p_chat,'direction','before','seq',first_item.seq,'position',first_item.position);
    r.after_cursor := jsonb_build_object('chatId',p_chat,'direction','after','seq',last_item.seq,'position',last_item.position);
    select exists(select 1 from public.history_element_rows e where e.chat_id=p_chat and (e.seq,e.position)<(first_item.seq,first_item.position)),
           exists(select 1 from public.history_element_rows e where e.chat_id=p_chat and (e.seq,e.position)>(last_item.seq,last_item.position))
      into r.has_before,r.has_after;
    if r.has_before then lower_bound:=jsonb_build_object('seq',first_item.seq,'position',first_item.position,'inclusive',true); end if;
    if r.has_after then upper_bound:=jsonb_build_object('seq',last_item.seq,'position',last_item.position,'inclusive',true); end if;
  elsif p_mode='after' then
    -- Reverse continuation includes the boundary omitted by an empty page.
    select e.* into first_item from public.history_element_rows e where e.chat_id=p_chat
      and (e.seq,e.position)<=(cursor_seq,cursor_pos) order by e.seq desc,e.position desc limit 1;
    r.has_before:=first_item.id is not null;
    r.before_cursor:=jsonb_build_object('chatId',p_chat,'direction','before','seq',first_item.seq,'position',first_item.position+1);
  elsif p_mode='before' then
    select e.* into last_item from public.history_element_rows e where e.chat_id=p_chat
      and (e.seq,e.position)>=(cursor_seq,cursor_pos) order by e.seq,e.position limit 1;
    r.has_after:=last_item.id is not null;
    r.after_cursor:=jsonb_build_object('chatId',p_chat,'direction','after','seq',last_item.seq,'position',last_item.position-1);
  end if;
  if p_mode='before' then upper_bound:=jsonb_build_object('seq',cursor_seq,'position',cursor_pos,'inclusive',false); end if;
  if p_mode='after' then lower_bound:=jsonb_build_object('seq',cursor_seq,'position',cursor_pos,'inclusive',false); end if;
  r.coverage:=jsonb_build_object('lower',lower_bound,'upper',upper_bound);
  if not r.has_before then r.before_cursor:=null; end if;
  if not r.has_after then r.after_cursor:=null; end if;
  if greatest(first_item.seq,last_item.seq)>9007199254740991 then
    raise exception 'Unsafe history position' using errcode='22023';
  end if;
  return next r;
end;
$$;

-- The bounded identifiers are selected BEFORE any content embedding. All
-- relationships are STABLE and share PostgREST's single statement snapshot.
create function public.history_window_elements(public.history_element_windows)
returns setof public.history_element_rows language sql stable security invoker set search_path=public
as $$ select e.* from public.history_element_rows e where e.chat_id=$1.chat_id
  and e.id=any($1.element_ids) order by e.seq,e.position limit 100 $$;

create function public.history_element_message(public.history_element_rows)
returns setof public.message_rows language sql stable security invoker set search_path=public rows 1
as $$ select m.* from public.message_rows m where m.chat_id=$1.chat_id and m.id=$1.message_id $$;

create function public.history_element_forward_item(public.history_element_rows)
returns setof public.forward_items language sql stable security invoker set search_path=public rows 1
as $$ select i.id,i.chat_id,i.forward_id,i.forward_kind,i.message_id,i.position,null::timestamptz,i.deleted_at
  from public.forward_items i where i.id=$1.forward_item_id and i.forward_id=$1.message_id
  and exists(select 1 from public.message_rows m where m.id=i.forward_id and m.chat_id=$1.chat_id and not m.hidden) $$;

revoke all on function public.get_history_element_window(uuid,text,integer,uuid,bigint,jsonb,uuid,integer) from public,anon;
revoke all on function public.history_window_elements(public.history_element_windows) from public,anon;
revoke all on function public.history_element_message(public.history_element_rows) from public,anon;
revoke all on function public.history_element_forward_item(public.history_element_rows) from public,anon;
grant execute on function public.get_history_element_window(uuid,text,integer,uuid,bigint,jsonb,uuid,integer) to authenticated;
grant execute on function public.history_window_elements(public.history_element_windows) to authenticated;
grant execute on function public.history_element_message(public.history_element_rows) to authenticated;
grant execute on function public.history_element_forward_item(public.history_element_rows) to authenticated;
