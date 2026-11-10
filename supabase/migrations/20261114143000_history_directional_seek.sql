create or replace function public.history_element_slice(p_chat uuid, p_seq bigint, p_position integer,
  p_direction text, p_limit integer, p_inclusive boolean default false, p_visible_only boolean default false)
returns setof public.history_element_rows language plpgsql stable security invoker set search_path=public
as $$
declare m record; i record; r public.history_element_rows; n integer:=0;
begin
  if p_limit is null or p_limit<0 or p_limit>100 or p_direction not in ('before','after')
    or p_direction is null then raise exception 'Invalid history slice' using errcode='22023'; end if;
  if p_limit=0 then return; end if;
  -- Keep the bounded index walk on (chat_id,seq) in both directions. A
  -- cached generic plan for ORDER BY CASE sorted the whole viewer-aware
  -- chat even to answer a one-row boundary probe. Only constant SQL
  -- fragments vary; all request values remain bound parameters.
  for m in execute
    'select x.id,x.chat_id,x.seq,x.kind,x.hidden from public.message_rows x where x.chat_id=$1'
    || case when p_seq is null then ''
            when p_direction='before' then ' and x.seq<=$2' else ' and x.seq>=$2' end
    || case when p_visible_only is not false then ' and not x.hidden' else '' end
    || case when p_direction='before' then ' order by x.seq desc' else ' order by x.seq asc' end
    || ' limit $3'
    using p_chat,p_seq,p_limit+1
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
