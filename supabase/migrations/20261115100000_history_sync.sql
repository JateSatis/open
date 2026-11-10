-- One entry per affected message and top-level transaction. No clock row or
-- destination fan-out: concurrent writers in unrelated chats never wait here.
create schema history_sync;
revoke all on schema history_sync from public, anon, authenticated;
create role open_history_reader nologin inherit;
grant authenticated to open_history_reader;
grant usage on schema history_sync to open_history_reader;

create table history_sync.events (
  message_id uuid not null,
  writer xid8 not null default pg_current_xact_id(),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (message_id, writer)
);
create index history_events_age on history_sync.events(recorded_at);
create table history_sync.state (
  singleton boolean primary key default true check (singleton),
  secret text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  pruned_through xid8 not null default '0'
);
insert into history_sync.state default values;
alter table history_sync.events enable row level security;
alter table history_sync.state enable row level security;
create policy journal_reader on history_sync.events for select to open_history_reader using (true);
create policy clock_reader on history_sync.state for select to open_history_reader using (true);
grant select on history_sync.events, history_sync.state to open_history_reader;

create function history_sync.record_statement() returns trigger
language plpgsql security definer set search_path = pg_catalog, history_sync as $$
begin
  if tg_table_name = 'forward_items' then
    insert into history_sync.events(message_id) select distinct forward_id from touched
      on conflict do nothing;
  else
    insert into history_sync.events(message_id) select id from touched on conflict do nothing;
  end if;
  return null;
end $$;
do $$
declare rel text; op text;
begin
  foreach rel in array array['messages','forward_items'] loop
    foreach op in array array['insert','update','delete'] loop
      execute format('create trigger %I after %s on public.%I referencing %s table as touched
        for each statement execute function history_sync.record_statement()',
        'history_sync_' || op, op, rel, case when op='delete' then 'old' else 'new' end);
    end loop;
  end loop;
end $$;

-- Advancing the conservative floor and pruning are one commit. If even an
-- in-flight xid of the old snapshot may have been pruned, force replacement.
create function history_sync.prune(p_before timestamptz, p_limit integer default 10000)
returns integer language plpgsql set search_path = pg_catalog, history_sync as $$
declare floor_xid xid8; n integer;
begin
  with removed as (
    delete from events where (message_id,writer) in (
      select message_id,writer from events where recorded_at < p_before
      order by recorded_at limit p_limit for update skip locked
    ) returning writer
  ) select max(writer), count(*) into floor_xid,n from removed;
  if n > 0 then update state set pruned_through=greatest(pruned_through,floor_xid); end if;
  return n;
end $$;
select cron.schedule('history-journal-retention','*/5 * * * *',
  $$select history_sync.prune(now() - interval '7 days')$$);

-- Only this non-login role can open or mint tickets. It inherits the caller's
-- authenticated policies, has no table ownership/BYPASSRLS on application data.
create function history_sync.seal(body jsonb) returns text
language sql volatile set search_path = '' as $$
  select 'h1.' || replace(encode(extensions.pgp_sym_encrypt(body::text,secret,
    'cipher-algo=aes256,s2k-mode=0,compress-algo=0'),'base64'), chr(10),'') from history_sync.state
$$;

create or replace view public.history_element_windows with (security_invoker=true) as
select null::uuid as chat_id, null::text as target_status, null::jsonb as anchor,
  null::jsonb as before_cursor, null::jsonb as after_cursor, false as has_before,
  false as has_after, null::jsonb as coverage, null::uuid[] as element_ids,
  null::uuid[] as parent_ids, null::text as sync_cursor where false;

-- The existing directional seek, probes and coverage rules are reused intact.
alter function public.get_history_element_window(uuid,text,integer,uuid,bigint,jsonb,uuid,integer)
  set schema history_sync;

-- Selected parents plus originals which the viewer can currently see. Preserve
-- the destination parent identity even for two appearances of the same original.
create function history_sync.dependencies(w public.history_element_windows)
returns table(parent_id uuid, entity_id uuid, hidden boolean, member boolean)
language sql stable set search_path='' as $$
  select m.id,m.id,m.hidden,public.am_chat_member(m.chat_id)
  from public.history_page_parents(w) m
  union all
  select f.forward_id, o.id, o.hidden, public.am_chat_member(o.chat_id)
  from public.history_page_forwards(w) f
  left join lateral (select m.id,m.hidden,m.chat_id from public.message_rows m
                     where m.id=f.message_id limit 1) o on true
$$;

create function history_sync.signature(w public.history_element_windows, rights jsonb)
returns text language sql immutable set search_path='' as $$
  select md5(jsonb_build_array(w.element_ids,rights)::text)
$$;

create function history_sync.issue(w public.history_element_windows) returns text
language sql stable set search_path='' as $$
  select history_sync.seal(jsonb_build_object('user',auth.uid(),'chat',w.chat_id,'range',w.coverage,
    'snapshot',pg_current_snapshot()::text,'shape',history_sync.signature(w,
    (select jsonb_agg(to_jsonb(d) order by d.parent_id,d.entity_id) from history_sync.dependencies(w) d))))
$$;

create function public.get_history_element_window(p_chat uuid, p_mode text, p_limit integer default 30,
  p_target uuid default null, p_hint_seq bigint default null, p_cursor jsonb default null,
  p_target_item uuid default null,p_hint_position integer default 0)
returns setof public.history_element_windows language plpgsql stable security definer
set search_path='' rows 1 as $$
declare w public.history_element_windows;
begin
  select * into strict w from history_sync.get_history_element_window(p_chat,p_mode,p_limit,p_target,
    p_hint_seq,p_cursor,p_target_item,p_hint_position);
  if w.coverage is not null then w.sync_cursor:=history_sync.issue(w); end if;
  return next w;
end $$;

create function history_sync.check_bound(b jsonb) returns void
language plpgsql immutable set search_path='' as $$
begin
  if b = 'null'::jsonb then return; end if;
  if jsonb_typeof(b) is distinct from 'object' or not (b ?& array['seq','position','inclusive'])
    or (b-array['seq','position','inclusive']) <> '{}'::jsonb
    or jsonb_typeof(b->'seq') <> 'number' or b->>'seq' !~ '^[0-9]{1,16}$'
    or (b->>'seq')::numeric > 9007199254740991
    or jsonb_typeof(b->'position') <> 'number' or b->>'position' !~ '^(-1|[0-9]{1,2}|100)$'
    or jsonb_typeof(b->'inclusive') <> 'boolean' then
    raise exception 'Invalid history bound' using errcode='22023';
  end if;
end $$;

-- Read from the saved lower bound. Stop at the original upper even after a
-- deletion. If growth fills this page, split the coverage and issue independent
-- tickets for each piece. No joined original contents outside selected IDs.
create function history_sync.read_range(p_chat uuid,p_range jsonb,p_limit integer)
returns public.history_element_windows language plpgsql stable set search_path='' as $$
declare w public.history_element_windows; lo jsonb:=p_range->'lower'; hi jsonb:=p_range->'upper';
  last_row public.history_element_rows; rows_found public.history_element_rows[];
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_chat is null or jsonb_typeof(p_range) is distinct from 'object'
    or not (p_range ?& array['lower','upper']) or (p_range-array['lower','upper']) <> '{}'::jsonb
    or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid history range' using errcode='22023'; end if;
  perform history_sync.check_bound(lo); perform history_sync.check_bound(hi);
  if ((lo->>'seq')::bigint,(lo->>'position')::int) > ((hi->>'seq')::bigint,(hi->>'position')::int)
    then raise exception 'Reversed history range' using errcode='22023'; end if;
  select coalesce(array_agg(e order by e.seq,e.position),'{}') into rows_found
  from public.history_element_slice(p_chat,(lo->>'seq')::bigint,(lo->>'position')::int,
    'after',p_limit,coalesce((lo->>'inclusive')::boolean,false)) e
  where hi='null' or (e.seq,e.position)<((hi->>'seq')::bigint,(hi->>'position')::int)
    or ((hi->>'inclusive')::boolean and (e.seq,e.position)=((hi->>'seq')::bigint,(hi->>'position')::int));
  select coalesce(array_agg(e.id order by e.seq,e.position),'{}'),coalesce(array_agg(distinct e.message_id),'{}')
    into w.element_ids,w.parent_ids from unnest(rows_found) e;
  last_row:=rows_found[cardinality(rows_found)];
  w.chat_id:=p_chat; w.target_status:='none'; w.has_before:=false; w.coverage:=p_range;
  w.has_after:=false;
  if cardinality(rows_found)=p_limit then
    select exists(select 1 from public.history_element_slice(p_chat,last_row.seq,last_row.position,'after',1) e
      where hi='null' or (e.seq,e.position)<((hi->>'seq')::bigint,(hi->>'position')::int)
        or ((hi->>'inclusive')::boolean and (e.seq,e.position)=((hi->>'seq')::bigint,(hi->>'position')::int)))
      into w.has_after;
  end if;
  if last_row.seq>9007199254740991 then raise exception 'Unsafe history position' using errcode='22023'; end if;
  if last_row.id is not null then
    w.before_cursor:=jsonb_build_object('chatId',p_chat,'direction','before','seq',rows_found[1].seq,
      'position',rows_found[1].position);
    w.after_cursor:=jsonb_build_object('chatId',p_chat,'direction','after','seq',last_row.seq,'position',last_row.position);
  end if;
  if w.has_after then w.coverage:=jsonb_set(p_range,'{upper}',jsonb_build_object(
    'seq',last_row.seq,'position',last_row.position,'inclusive',true)); end if;
  return w;
end $$;

create function public.get_history_range(p_chat uuid,p_range jsonb,p_limit integer default 100)
returns setof public.history_element_windows language plpgsql stable security definer set search_path='' rows 1 as $$
declare w public.history_element_windows;
begin
  w:=history_sync.read_range(p_chat,p_range,p_limit);
  w.sync_cursor:=history_sync.issue(w);
  return next w;
end $$;

-- One pass computes a bounded set (<=100 visible parents) under one MVCC upper
-- snapshot. Continuations consume that frozen set, checking access again.
create function public.get_history_changes(p_chat uuid,p_cursor text,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t jsonb; baseline pg_snapshot; ceiling pg_snapshot; w public.history_element_windows;
  pending uuid[]; ids uuid[]; shape text; dirty boolean; result text; next_token text;
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
  if (select pruned_through from history_sync.state)>=pg_snapshot_xmin(baseline) then
    return jsonb_build_object('status','expired','parentIds','[]'::jsonb,'cursor',null); end if;
  if t ? 'pending' then
    select array(select jsonb_array_elements_text(t->'pending')::uuid) into pending;
    dirty:=true;
  else
    ceiling:=pg_current_snapshot();
    w:=history_sync.read_range(p_chat,t->'range',100);
    with deps as materialized (select * from history_sync.dependencies(w)),
    affected as (
      select distinct d.parent_id from deps d where not d.hidden and exists (
        select 1 from history_sync.events e where e.message_id=d.entity_id
          and e.writer>=pg_snapshot_xmin(baseline) and e.writer<pg_snapshot_xmax(ceiling)
          and not pg_visible_in_snapshot(e.writer,baseline) and pg_visible_in_snapshot(e.writer,ceiling)
      )
    )
    select history_sync.signature(w,(select jsonb_agg(to_jsonb(d) order by d.parent_id,d.entity_id) from deps d)),
      array(select parent_id from affected order by parent_id) into shape,pending;
    dirty:=w.has_after or shape<>t->>'shape' or cardinality(pending)>0;
    t:=jsonb_set(t,'{snapshot}',to_jsonb(ceiling::text));
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

alter function public.get_history_element_window(uuid,text,integer,uuid,bigint,jsonb,uuid,integer) owner to open_history_reader;
alter function public.get_history_range(uuid,jsonb,integer) owner to open_history_reader;
alter function public.get_history_changes(uuid,text,integer) owner to open_history_reader;
revoke all on all functions in schema history_sync from public,anon,authenticated;
grant execute on function history_sync.seal(jsonb),history_sync.signature(public.history_element_windows,jsonb),
  history_sync.issue(public.history_element_windows),history_sync.dependencies(public.history_element_windows),
  history_sync.get_history_element_window(uuid,text,integer,uuid,bigint,jsonb,uuid,integer),
  history_sync.check_bound(jsonb),history_sync.read_range(uuid,jsonb,integer) to open_history_reader;
revoke all on function public.get_history_element_window(uuid,text,integer,uuid,bigint,jsonb,uuid,integer),
  public.get_history_range(uuid,jsonb,integer),public.get_history_changes(uuid,text,integer) from public,anon;
grant execute on function public.get_history_element_window(uuid,text,integer,uuid,bigint,jsonb,uuid,integer),
  public.get_history_range(uuid,jsonb,integer),public.get_history_changes(uuid,text,integer) to authenticated;
notify pgrst,'reload schema';
