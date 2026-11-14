-- All callers need at most 100 unread parents, and only the first remaining
-- occurrence of each. Walk the parent index once rather than joining every
-- original of a large forward for every ordinary row in the same chat.
create or replace function public.unread_occurrences(c uuid,s bigint,p integer,member boolean)
returns table(seq bigint,pos integer,parent uuid,item uuid)
language plpgsql stable set search_path=public as $$
declare m record; i record; n integer:=0; blockers uuid[]:=public.my_blockers();
  hold bigint:=case when not member then public.chat_public_hold(c) end;
  show_blockers boolean:=public.blocker_message_visible(c);
begin
  if not public.chat_readable(c) then return; end if;
  for m in select x.id,x.seq,x.kind from messages x where x.chat_id=c and x.seq>=s
    and x.deleted_at is null and (hold is null or x.seq<hold)
    and x.author_id is distinct from auth.uid()
    and (show_blockers or x.kind='system' or not coalesce(x.author_id=any(blockers),false))
    and (member or (x.kind<>'system' and not exists(select 1 from attachments a
      join pop_views v on v.pop_id=a.pop_id and v.viewer_id=auth.uid() where a.message_id=x.id)))
    order by x.seq
  loop
    if m.kind='forward' then
      select f.id,f.position into i from forward_items f
        where f.forward_id=m.id and f.chat_id=c and f.deleted_at is null
        and (m.seq>s or f.position>p)
        and exists(select 1 from message_rows original where original.id=f.message_id and not original.hidden)
        order by f.position limit 1;
      if not found then continue; end if;
      item:=i.id; pos:=i.position;
    else
      if (m.seq,0)<=(s,p) then continue; end if;
      item:=null; pos:=0;
    end if;
    parent:=m.id; seq:=m.seq; return next;
    n:=n+1; if n>=100 then return; end if;
  end loop;
end $$;
