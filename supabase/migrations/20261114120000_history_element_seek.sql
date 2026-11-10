-- Walk the existing chat/seq index first. A SQL LEFT JOIN followed by ORDER BY
-- seq,position could sort every visible parent before applying a small limit.
create function public.history_element_slice(p_chat uuid, p_seq bigint, p_position integer,
  p_direction text, p_limit integer, p_inclusive boolean default false, p_visible_only boolean default false)
returns setof public.history_element_rows language plpgsql stable security invoker set search_path=public
as $$
declare m record; i record; r public.history_element_rows; n integer:=0;
begin
  if p_limit is null or p_limit<0 or p_limit>100 or p_direction not in ('before','after')
    or p_direction is null then raise exception 'Invalid history slice' using errcode='22023'; end if;
  if p_limit=0 then return; end if;
  for m in
    select x.id,x.chat_id,x.seq,x.kind,x.hidden from public.message_rows x
    where x.chat_id=p_chat and (p_seq is null or
      (p_direction='before' and x.seq<=p_seq) or (p_direction='after' and x.seq>=p_seq))
      and (not p_visible_only or not x.hidden)
    order by case when p_direction='before' then x.seq end desc,
      case when p_direction='after' then x.seq end asc
    limit p_limit+1
  loop
    r.message_id:=m.id; r.chat_id:=m.chat_id; r.seq:=m.seq; r.hidden:=m.hidden;
    if m.kind='forward' and not m.hidden and exists(select 1 from public.forward_items f where f.forward_id=m.id) then
      for i in select f.id,f.position from public.forward_items f where f.forward_id=m.id
        and (p_seq is null or m.seq<>p_seq or
          (p_direction='before' and (f.position<p_position or (p_inclusive and f.position=p_position))) or
          (p_direction='after' and (f.position>p_position or (p_inclusive and f.position=p_position))))
        order by case when p_direction='before' then f.position end desc,
          case when p_direction='after' then f.position end asc
        limit p_limit-n
      loop
        r.id:=i.id; r.position:=i.position; r.forward_item_id:=i.id;
        return next r; n:=n+1;
      end loop;
    elsif p_seq is null or m.seq<>p_seq or
      (p_direction='before' and (0<p_position or (p_inclusive and p_position=0))) or
      (p_direction='after' and (0>p_position or (p_inclusive and p_position=0))) then
      r.id:=m.id; r.position:=0; r.forward_item_id:=null;
      return next r; n:=n+1;
    end if;
    if n>=p_limit then return; end if;
  end loop;
end;
$$;
revoke all on function public.history_element_slice(uuid,bigint,integer,text,integer,boolean,boolean) from public,anon;
grant execute on function public.history_element_slice(uuid,bigint,integer,text,integer,boolean,boolean) to authenticated;

create or replace function public.get_history_elements(p_chat uuid,p_ids uuid[])
returns setof public.history_element_rows language plpgsql stable security invoker set search_path=public
as $$
begin
  if p_chat is null or p_ids is null or cardinality(p_ids)>100 or array_ndims(p_ids)>1 then
    raise exception 'History ids limit is 100' using errcode='22023';
  end if;
  return query select e.* from public.history_element_rows e
  where e.chat_id=p_chat and e.id=any(p_ids) and e.message_id in (
    select m.id from public.message_rows m where m.chat_id=p_chat and m.id=any(p_ids)
    union select i.forward_id from public.forward_items i where i.chat_id=p_chat and i.id=any(p_ids)
  ) order by e.seq,e.position limit 100;
end;
$$;

create or replace function public.get_history_element_window(
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
      select e.* into pivot from public.history_element_slice(p_chat,p_hint_seq,p_hint_position,'after',1,true,true)e;
      if pivot.id is null then
        select e.* into pivot from public.history_element_slice(p_chat,p_hint_seq,p_hint_position,'before',1,false,true)e;
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
      select e.id,e.seq,e.position from public.history_element_slice(p_chat,pivot.seq,pivot.position,'before',take_before,center_count=0)e
    )x;
    select coalesce(array_agg(x.id order by x.seq,x.position),'{}') into right_ids from (
      select e.id,e.seq,e.position from public.history_element_slice(p_chat,pivot.seq,pivot.position,'after',p_limit-center_count-cardinality(left_ids))e
    )x;
    if cardinality(right_ids)<p_limit-center_count-cardinality(left_ids) then
      select coalesce(array_agg(x.id order by x.seq,x.position),'{}') into left_ids from (
        select e.id,e.seq,e.position from public.history_element_slice(p_chat,pivot.seq,pivot.position,'before',p_limit-center_count-cardinality(right_ids),center_count=0)e
      )x;
    end if;
    r.element_ids := left_ids || case when center_count=0 then '{}'::uuid[] else array[pivot.id] end || right_ids;
  elsif p_mode in ('latest','before') then
    select coalesce(array_agg(x.id order by x.seq,x.position),'{}') into r.element_ids from (
      select e.id,e.seq,e.position from public.history_element_slice(p_chat,cursor_seq,cursor_pos,'before',p_limit)e
    )x;
  else
    select coalesce(array_agg(x.id order by x.seq,x.position),'{}') into r.element_ids from (
      select e.id,e.seq,e.position from public.history_element_slice(p_chat,cursor_seq,cursor_pos,'after',p_limit)e
    )x;
  end if;
  select e.* into first_item from public.get_history_elements(p_chat,array[r.element_ids[1]]) e;
  select e.* into last_item from public.get_history_elements(p_chat,array[r.element_ids[cardinality(r.element_ids)]]) e;
  if first_item.id is not null then
    r.before_cursor := jsonb_build_object('chatId',p_chat,'direction','before','seq',first_item.seq,'position',first_item.position);
    r.after_cursor := jsonb_build_object('chatId',p_chat,'direction','after','seq',last_item.seq,'position',last_item.position);
    select exists(select 1 from public.history_element_slice(p_chat,first_item.seq,first_item.position,'before',1)),
           exists(select 1 from public.history_element_slice(p_chat,last_item.seq,last_item.position,'after',1))
      into r.has_before,r.has_after;
    if r.has_before then lower_bound:=jsonb_build_object('seq',first_item.seq,'position',first_item.position,'inclusive',true); end if;
    if r.has_after then upper_bound:=jsonb_build_object('seq',last_item.seq,'position',last_item.position,'inclusive',true); end if;
  elsif p_mode='after' then
    -- Reverse continuation includes the boundary omitted by an empty page.
    select e.* into first_item from public.history_element_slice(p_chat,cursor_seq,cursor_pos,'before',1,true)e;
    r.has_before:=first_item.id is not null;
    r.before_cursor:=jsonb_build_object('chatId',p_chat,'direction','before','seq',first_item.seq,'position',first_item.position+1);
  elsif p_mode='before' then
    select e.* into last_item from public.history_element_slice(p_chat,cursor_seq,cursor_pos,'after',1,true)e;
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


