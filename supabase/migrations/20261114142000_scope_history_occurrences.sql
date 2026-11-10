-- Messages and forward_items have independent UUID namespaces. An ordinary
-- message ID can also be an item ID, even for a partly loaded group on this
-- page. Match the selected parents AND the window coordinates.
create or replace function public.history_page_forwards(w public.history_element_windows)
returns setof public.forward_items language sql stable security invoker
set search_path = public
as $$
  select f.id,f.chat_id,f.forward_id,f.forward_kind,f.message_id,f.position,null::timestamptz,f.deleted_at
  from public.forward_items f
  where cardinality(w.element_ids)<=100 and f.chat_id=w.chat_id
    and f.id=any(w.element_ids) and f.forward_id=any(w.parent_ids)
    and exists (
      select 1 from public.message_rows m where m.id=f.forward_id and m.chat_id=w.chat_id and not m.hidden
        and (w.before_cursor is null or (m.seq,f.position)>=
          ((w.before_cursor->>'seq')::bigint,(w.before_cursor->>'position')::integer))
        and (w.after_cursor is null or (m.seq,f.position)<=
          ((w.after_cursor->>'seq')::bigint,(w.after_cursor->>'position')::integer))
    )
$$;
