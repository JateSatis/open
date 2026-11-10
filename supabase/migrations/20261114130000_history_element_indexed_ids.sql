-- Materialize only the bounded parent ids. Do not let the planner turn this
-- lookup into a scan of the entire viewer-aware chat before checking ids.
create or replace function public.get_history_elements(p_chat uuid,p_ids uuid[])
returns setof public.history_element_rows language plpgsql stable security invoker set search_path=public
as $$
begin
  if p_chat is null or p_ids is null or cardinality(p_ids)>100 or array_ndims(p_ids)>1 then
    raise exception 'History ids limit is 100' using errcode='22023';
  end if;
  return query
  with parents as materialized (
    select m.id from public.message_rows m where m.chat_id=p_chat and m.id=any(p_ids)
    union select i.forward_id from public.forward_items i where i.chat_id=p_chat and i.id=any(p_ids)
  )
  select e.* from parents p cross join lateral (
    select x.* from public.history_element_rows x where x.message_id=p.id
      and x.chat_id=p_chat and x.id=any(p_ids) limit 100
  )e order by e.seq,e.position limit 100;
end;
$$;
