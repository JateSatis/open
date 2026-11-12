-- Use a pruning generation as well as the xid floor. A freshly issued cursor
-- already includes every committed deletion visible to its own snapshot.
alter table history_sync.state add column pruned_by xid8 not null default '0';

create or replace function history_sync.prune(p_before timestamptz, p_limit integer default 10000)
returns integer language plpgsql set search_path = pg_catalog, history_sync as $$
declare floor_xid xid8; n integer;
begin
  with removed as (
    delete from events where (message_id,writer) in (
      select message_id,writer from events where recorded_at < p_before
      order by recorded_at limit p_limit for update skip locked
    ) returning writer
  ) select max(writer), count(*) into floor_xid,n from removed;
  if n > 0 then update state set pruned_by=pg_current_xact_id(), pruned_through=greatest(pruned_through,floor_xid); end if;
  return n;
end $$;

-- A journal hit is a candidate, not permission to reveal private activity.
-- Fingerprint only the selected parent/occurrence as visible through the same
-- viewer projections. Private read counts and inaccessible siblings can change
-- without changing a single field the viewer can see.
create function history_sync.visible_stamp(m public.message_rows) returns text
language sql stable set search_path='' as $$
  select md5(jsonb_build_array(
    case when m.hidden then jsonb_build_array(m.id,m.seq,true) else to_jsonb(m) end,
    public.am_chat_member(m.chat_id),
    case when m.kind in ('media','voice') and not m.hidden then
      (select jsonb_agg(to_jsonb(a) order by a.id) from public.attachment_rows a where a.message_id=m.id)
    end)::text)
$$;

create function history_sync.visible_entities(w public.history_element_windows)
returns table(parent_id uuid,entity_id uuid,stamp text) language sql stable set search_path='' as $$
  select m.id,case when not m.hidden then m.id end,history_sync.visible_stamp(m)
  from public.history_page_parents(w) m
  union all
  select f.forward_id,case when not o.hidden then o.id end,
    md5(jsonb_build_array(f.id,f.position,f.message_id,o.stamp)::text)
  from public.history_page_forwards(w) f
  left join lateral (select m.id,m.hidden,history_sync.visible_stamp(m) stamp
                     from public.message_rows m where m.id=f.message_id limit 1) o on true
$$;

create or replace function history_sync.issue(w public.history_element_windows) returns text
language sql stable set search_path='' as $$
  select history_sync.seal(jsonb_build_object('user',auth.uid(),'chat',w.chat_id,'range',w.coverage,
    'snapshot',pg_current_snapshot()::text,'generation',(select pruned_by::text from history_sync.state),
    'shape',md5(w.element_ids::text),'marks',coalesce(jsonb_object_agg(p.parent_id,p.stamp),'{}')))
  from (select parent_id,md5(string_agg(stamp,',' order by stamp)) stamp
        from history_sync.visible_entities(w) group by parent_id) p
$$;

create or replace function public.get_history_changes(p_chat uuid,p_cursor text,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t jsonb; baseline pg_snapshot; ceiling pg_snapshot; w public.history_element_windows;
  pending uuid[]; ids uuid[]; marks jsonb; generation xid8; floor_xid xid8; dirty boolean; result text; next_token text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 or p_chat is null then
    raise exception 'Invalid change request' using errcode='22023'; end if;
  if p_cursor is null or left(p_cursor,3)<>'h1.' or length(p_cursor)>262144 then
    return jsonb_build_object('status','expired','parentIds','[]'::jsonb,'cursor',null); end if;
  begin
    select extensions.pgp_sym_decrypt(decode(substr(p_cursor,4),'base64'),secret)::jsonb
      into t from history_sync.state;
  exception when data_exception or external_routine_invocation_exception then
    return jsonb_build_object('status','expired','parentIds','[]'::jsonb,'cursor',null);
  end;
  if t->>'user' is distinct from auth.uid()::text or t->>'chat' is distinct from p_chat::text then
    raise exception 'Cursor belongs to a different reader or chat' using errcode='22023'; end if;
  baseline:=(t->>'snapshot')::pg_snapshot;
  select pruned_through,pruned_by into floor_xid,generation from history_sync.state;
  if not (t ? 'marks') or (t->>'generation' is distinct from generation::text and floor_xid>=pg_snapshot_xmin(baseline)) then
    return jsonb_build_object('status','expired','parentIds','[]'::jsonb,'cursor',null); end if;
  if t ? 'pending' then
    select array(select jsonb_array_elements_text(t->'pending')::uuid) into pending;
    dirty:=true;
  else
    ceiling:=pg_current_snapshot();
    w:=history_sync.read_range(p_chat,t->'range',100);
    with deps as materialized (select * from history_sync.visible_entities(w)),
    parents as materialized (
      select parent_id, md5(string_agg(stamp,',' order by stamp)) stamp from deps group by parent_id
    ), affected as (
      select p.parent_id from parents p where p.stamp is distinct from (t->'marks'->>p.parent_id::text)
        and exists (select 1 from deps d join history_sync.events e on e.message_id=d.entity_id
          where d.parent_id=p.parent_id and e.writer>=pg_snapshot_xmin(baseline)
            and e.writer<pg_snapshot_xmax(ceiling) and not pg_visible_in_snapshot(e.writer,baseline)
            and pg_visible_in_snapshot(e.writer,ceiling))
    )
    select coalesce((select jsonb_object_agg(parent_id,stamp) from parents),'{}'),
      array(select parent_id from affected order by parent_id) into marks,pending;
    dirty:=w.has_after or md5(w.element_ids::text)<>t->>'shape' or marks<>t->'marks';
    -- The ceiling now acknowledges only this window. Frozen continuations need
    -- neither the old fingerprints nor any metadata from other readers.
    t:=t || jsonb_build_object('snapshot',ceiling::text,'generation',generation::text);
  end if;
  -- The cursor contains only parents visible when the pass began. A revoked
  -- parent can produce an empty intermediate page; always consume that slot.
  select array(select m.id from public.message_rows m where m.chat_id=p_chat and not m.hidden
    and m.id=any(pending[1:p_limit]) order by m.id) into ids;
  if cardinality(pending)>p_limit then
    result:='more'; next_token:=history_sync.seal(t || jsonb_build_object('pending',pending[p_limit+1:]));
  elsif dirty then result:='reconcile';
  else result:='current'; next_token:=history_sync.seal(t); end if;
  return jsonb_build_object('status',result,'parentIds',ids,'cursor',next_token);
end $$;


drop function history_sync.dependencies(public.history_element_windows);
drop function history_sync.signature(public.history_element_windows,jsonb);
revoke all on function history_sync.visible_entities(public.history_element_windows),
  history_sync.visible_stamp(public.message_rows) from public,anon,authenticated;
grant execute on function history_sync.visible_entities(public.history_element_windows),
  history_sync.visible_stamp(public.message_rows) to open_history_reader;
