-- Store the inclusive coordinate on the private role row. No FK to a message:
-- removing an occurrence must not move the boundary (or expose its replacement).
alter table public.chat_members add column read_seq bigint not null default 0,
  add column read_position integer not null default 0;
alter table public.subscriptions add column read_seq bigint not null default 0,
  add column read_position integer not null default 0;
revoke update(last_read_at) on public.chat_members from authenticated;

-- Legacy timestamps describe whole parents. Stop before the first unread or
-- unpublished parent: public_at may be out of order behind a publication hold.
create function public.legacy_read_seq(c uuid, stamp timestamptz, member boolean)
returns bigint language sql stable security definer set search_path=public as $$
  select coalesce((select m.seq from messages m where m.chat_id=c
    and m.seq < coalesce((select min(u.seq) from messages u where u.chat_id=c
      and u.deleted_at is null and (case when member then u.created_at else u.public_at end > stamp
        or (not member and u.seq >= public.chat_public_hold(c)))),9223372036854775807)
    and (case when member then m.created_at else m.public_at end)<=stamp
    order by m.seq desc limit 1),0)
$$;
revoke all on function public.legacy_read_seq(uuid,timestamptz,boolean) from public, anon, authenticated;

update public.chat_members set read_seq=public.legacy_read_seq(chat_id,last_read_at,true),read_position=99;
update public.subscriptions s set read_seq=public.legacy_read_seq(coalesce(s.chat_id,
  (select ch.posts_chat_id from channels ch where ch.id=s.channel_id)),s.messages_read_at,false),read_position=99;

-- Initialize joins/subscriptions and translate explicit Read All / old clients.
create function public.initialize_read_frontier() returns trigger language plpgsql
security definer set search_path=public as $$
declare c uuid; stamp timestamptz; candidate bigint;
begin
  if tg_op='UPDATE' then
    if (new.read_seq,new.read_position)<>(old.read_seq,old.read_position) then return new; end if;
  end if;
  if tg_table_name='chat_members' then
    c:=new.chat_id; stamp:=new.last_read_at;
    if tg_op='UPDATE' and new.last_read_at is not distinct from old.last_read_at then return new; end if;
  else
    c:=coalesce(new.chat_id,(select posts_chat_id from channels where id=new.channel_id));
    stamp:=new.messages_read_at;
    if tg_op='UPDATE' and new.messages_read_at is not distinct from old.messages_read_at then return new; end if;
  end if;
  candidate:=public.legacy_read_seq(c,stamp,tg_table_name='chat_members');
  if (candidate,99)>(new.read_seq,new.read_position) then new.read_seq:=candidate; new.read_position:=99; end if;
  return new;
end $$;
revoke all on function public.initialize_read_frontier() from public, anon, authenticated;
create trigger member_read_init before insert or update of last_read_at on public.chat_members
  for each row execute function public.initialize_read_frontier();
create trigger subscription_read_init before insert or update of messages_read_at on public.subscriptions
  for each row execute function public.initialize_read_frontier();

-- SECURITY DEFINER callers bypass forward_items RLS. Both the parent and
-- referenced original must be visible as message_rows to the session user.
create function public.readable_occurrences(c uuid, s bigint, p integer, only_seq bigint default null)
returns table(seq bigint,pos integer,parent uuid,item uuid,author uuid,kind text)
language sql stable security definer set search_path=public as $$
  select m.seq,coalesce(i.position,0),m.id,i.id,m.author_id,m.kind
  from public.messages m
  join public.message_rows shown on shown.id=m.id and not shown.hidden
  left join lateral (
    select f.id,f.position from forward_items f join message_rows o on o.id=f.message_id and not o.hidden
    where f.forward_id=m.id and f.chat_id=c and f.deleted_at is null
  ) i on m.kind='forward'
  where m.chat_id=c and m.seq>=s and (only_seq is null or m.seq=only_seq)
    and (m.kind<>'forward' or i.id is not null) and (m.seq,coalesce(i.position,0))>(s,p)
$$;
revoke all on function public.readable_occurrences(uuid,bigint,integer,bigint) from public, anon, authenticated;

create function public.unread_occurrences(c uuid,s bigint,p integer,member boolean)
returns table(seq bigint,pos integer,parent uuid,item uuid)
language sql stable set search_path=public as $$
  select e.seq,e.pos,e.parent,e.item from public.readable_occurrences(c,s,p) e
  where e.author is distinct from auth.uid() and (member or (e.kind<>'system' and not exists (
    select 1 from attachments a join pop_views v on v.pop_id=a.pop_id and v.viewer_id=auth.uid()
      where a.message_id=e.parent)))
$$;
revoke all on function public.unread_occurrences(uuid,bigint,integer,boolean) from public, anon, authenticated;

create function public.history_read_state(p_chat uuid)
returns table(read_seq bigint,read_position integer,first_seq bigint,first_position integer,first_message uuid,first_item uuid)
language sql stable security definer set search_path=public as $$
  with owner as (
    select m.read_seq,m.read_position,true as member from chat_members m where m.chat_id=p_chat and m.user_id=auth.uid()
    union all select s.read_seq,s.read_position,false from subscriptions s
      left join channels ch on ch.id=s.channel_id and ch.deleted_at is null
      where s.subscriber_id=auth.uid() and (s.chat_id=p_chat or ch.posts_chat_id=p_chat)
  )
  select o.read_seq,o.read_position,e.seq,e.pos,e.parent,e.item from owner o
  left join lateral (select * from public.unread_occurrences(p_chat,o.read_seq,o.read_position,o.member)
    order by seq,pos limit 1) e on true where public.chat_readable(p_chat)
  order by o.member desc limit 1
$$;
revoke all on function public.history_read_state(uuid) from public,anon;
grant execute on function public.history_read_state(uuid) to authenticated;

create function public.advance_history_read(p_chat uuid,p_seq bigint,p_position int,p_key uuid,p_expected_reader uuid)
returns table(read_seq bigint,read_position integer)
language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); sub uuid; member boolean; stamp timestamptz;
begin
  if me is null or p_expected_reader is distinct from me or not public.chat_readable(p_chat)
    then raise exception 'Reader not allowed' using errcode='42501'; end if;
  select exists(select 1 from chat_members cm where cm.chat_id=p_chat and cm.user_id=me) into member;
  if not member then
    select s.id into sub from subscriptions s left join channels ch on ch.id=s.channel_id and ch.deleted_at is null
      where s.subscriber_id=me and (s.chat_id=p_chat or ch.posts_chat_id=p_chat);
    if sub is null then raise exception 'Reader not allowed' using errcode='42501'; end if;
  end if;
  if not exists(select 1 from public.readable_occurrences(p_chat,p_seq,-1,p_seq) e
    where e.pos=p_position and coalesce(e.item,e.parent)=p_key) then
    raise exception 'Occurrence unavailable' using errcode='22023'; end if;
  if member then
    -- Legacy public receipt is whole-message precision. Do not expose the
    -- forwarding parent as fully read while some of its occurrences are ahead.
    select m.created_at into stamp from messages m where m.chat_id=p_chat and m.seq<=p_seq and
      (m.seq<p_seq or not exists(select 1 from forward_items i where i.forward_id=m.id
        and i.deleted_at is null and i.position>p_position)) order by m.seq desc limit 1;
    update chat_members cm set read_seq=p_seq,read_position=p_position,last_read_at=greatest(cm.last_read_at,stamp)
      where cm.chat_id=p_chat and cm.user_id=me and (cm.read_seq,cm.read_position)<(p_seq,p_position);
    return query select cm.read_seq,cm.read_position from chat_members cm where cm.chat_id=p_chat and cm.user_id=me;
  else
    update subscriptions s set read_seq=p_seq,read_position=p_position
      where s.id=sub and s.subscriber_id=me and (s.read_seq,s.read_position)<(p_seq,p_position);
    return query select s.read_seq,s.read_position from subscriptions s where s.id=sub and s.subscriber_id=me;
  end if;
end $$;
revoke all on function public.advance_history_read(uuid,bigint,integer,uuid,uuid) from public,anon;
grant execute on function public.advance_history_read(uuid,bigint,integer,uuid,uuid) to authenticated;

create function public.signal_my_history_read() returns trigger language plpgsql
security definer set search_path=public as $$
declare reader uuid; c uuid; ch uuid;
begin
  if tg_table_name='chat_members' then reader:=new.user_id; c:=new.chat_id;
  else reader:=new.subscriber_id; ch:=new.channel_id;
    c:=coalesce(new.chat_id,(select posts_chat_id from channels where id=ch)); end if;
  perform realtime.send(jsonb_build_object('chat_id',c,'channel_id',ch),'history_read','user:'||reader,true);
  return null;
end $$;
revoke all on function public.signal_my_history_read() from public,anon,authenticated;
create trigger member_read_signal after update on public.chat_members for each row
  when ((new.read_seq,new.read_position)<>(old.read_seq,old.read_position)) execute function public.signal_my_history_read();
create trigger subscription_read_signal after update on public.subscriptions for each row
  when ((new.read_seq,new.read_position)<>(old.read_seq,old.read_position)) execute function public.signal_my_history_read();

-- A partly read forward still counts as one unread post. Preserve the cap,
-- Pop views and own-message exclusions from my_[channel_]subscriptions.
create or replace function public.subscription_unread_messages(target_chat uuid,since timestamptz,viewer uuid)
returns integer language sql stable security definer set search_path=public as $$
  select count(*)::int from (
    select distinct e.seq from subscriptions s left join channels ch on ch.id=s.channel_id
    cross join lateral public.unread_occurrences(target_chat,s.read_seq,s.read_position,false) e
    where viewer=auth.uid() and s.subscriber_id=viewer and (s.chat_id=target_chat or ch.posts_chat_id=target_chat)
    limit 100
  ) unread
$$;
create or replace function public.my_chat_list()
returns table (chat_id uuid, entered_at timestamptz, "position" integer, has_unread boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  return query
  with mine as (
    select cm.chat_id, cm.joined_at as entered, cm.read_seq, cm.read_position, true as member
    from public.chat_members cm
    where cm.user_id = me
    union all
    select coalesce(s.chat_id, ch.posts_chat_id), s.in_chats_at, null, null, false
    from public.subscriptions s
    left join public.channels ch on ch.id = s.channel_id
    where s.subscriber_id = me
      and (s.chat_id is not null or s.in_chats)
  ),
  deduped as (
    select distinct on (m.chat_id) m.*
    from mine m
    where m.chat_id is not null
    order by m.chat_id, m.member desc
  ),
  facts as (
    select
      d.chat_id,
      d.entered,
      d.member,
      d.read_seq, d.read_position,
      last.created_at as last_at,
      last.author_id as last_author,
      ch.last_pop_at
    from deduped d
    join public.chats c on c.id = d.chat_id and c.deleted_at is null
    left join public.channels ch on ch.posts_chat_id = c.id
    left join lateral (
      -- Подписчику — последнее опубликованное и время публикации: порядок
      -- «Чатов» не выдаёт неопубликованного.
      select case when d.member then m.created_at else m.public_at end as created_at, m.author_id
      from public.messages m
      where m.chat_id = d.chat_id and m.deleted_at is null
        and (d.member or m.seq < coalesce(public.chat_public_hold(d.chat_id), 9223372036854775807))
      order by m.seq desc
      limit 1
    ) last on true
  )
  select
    f.chat_id,
    case when public.chat_time_visible(f.chat_id) then f.entered end,
    (row_number() over (
      order by greatest(f.last_at, f.last_pop_at, f.entered) desc nulls last, f.chat_id
    ) - 1)::int,
    case when f.member then exists(select 1 from public.unread_occurrences(f.chat_id,f.read_seq,f.read_position,true)) else false end
  from facts f;
end;
$$;
