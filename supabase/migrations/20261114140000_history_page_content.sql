-- One copy of each viewer-visible parent per page. The envelope's element_ids
-- supply the order; deleted originals keep their occurrence and nullable embed.
-- Leave the old relationships available to already installed releases.
create function public.history_page_parents(w public.history_element_windows)
returns setof public.message_rows language sql stable security invoker
set search_path = public
as $$
  select m.* from public.message_rows m
  where m.chat_id=w.chat_id and m.id=any(array(
    select unnest(w.element_ids)
    union all
    select f.forward_id from public.forward_items f
    where f.chat_id=w.chat_id and f.id=any(w.element_ids)
  ))
$$;

create function public.history_page_forwards(w public.history_element_windows)
returns setof public.forward_items language sql stable security invoker
set search_path = public
as $$
  select f.id,f.chat_id,f.forward_id,f.forward_kind,f.message_id,f.position,null::timestamptz,f.deleted_at
  from public.forward_items f
  where f.chat_id=w.chat_id and f.id=any(w.element_ids)
    and exists (select 1 from public.message_rows m where m.id=f.forward_id and m.chat_id=w.chat_id and not m.hidden)
$$;
revoke all on function public.history_page_parents(public.history_element_windows),
  public.history_page_forwards(public.history_element_windows) from public,anon;
grant execute on function public.history_page_parents(public.history_element_windows),
  public.history_page_forwards(public.history_element_windows) to authenticated;
notify pgrst, 'reload schema';
