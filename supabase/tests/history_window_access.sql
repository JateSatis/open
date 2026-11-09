-- Real PostgreSQL/RLS contract tests. All fixtures are rolled back.
begin;
create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end;
$$;
create function pg_temp.act(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.cursor(c uuid, d text, s bigint) returns jsonb language sql as $$
  select jsonb_build_object('chatId',c,'direction',d,'seq',s)
$$;
insert into auth.users(id,email,raw_user_meta_data,aud,role) values
 ('00000000-0000-4000-8000-0000000091a1','window-a@test.local','{"full_name":"Window A"}','authenticated','authenticated'),
 ('00000000-0000-4000-8000-0000000091b1','window-b@test.local','{"full_name":"Window B"}','authenticated','authenticated'),
 ('00000000-0000-4000-8000-0000000091c1','window-v@test.local','{"full_name":"Window V"}','authenticated','authenticated');
update public.privacy_settings set public_message_visibility_delay='off',
 profile_identity_masking='everyone', dialogue_participant_name_masking='everyone',
 dialogue_media_visibility='everyone', message_activity_metadata_visibility='everyone'
where user_id in ('00000000-0000-4000-8000-0000000091a1','00000000-0000-4000-8000-0000000091b1','00000000-0000-4000-8000-0000000091c1');

do $$
declare
 a uuid := '00000000-0000-4000-8000-0000000091a1';
 b uuid := '00000000-0000-4000-8000-0000000091b1';
 v uuid := '00000000-0000-4000-8000-0000000091c1';
 c uuid; other uuid; channel uuid; ids uuid[]; seqs bigint[]; seen uuid[];
 r public.history_window_rows; x public.history_window_rows; n int; i int;
 gone uuid; delayed uuid; hidden uuid; secret uuid; outsider uuid;
 start_read timestamptz; final_read timestamptz; fwd uuid; media uuid; quote uuid;
 path text := a::text || '/history-window.jpg';
begin
 insert into public.chats(kind,created_by,owner_id,title,founding_member_ids)
 values ('group',a,a,'History window test',array[a,b]) returning id into c;
 insert into public.chat_members(chat_id,user_id) values(c,a),(c,b);
 insert into public.chats(kind,created_by,owner_id,title) values('group',a,a,'Window other') returning id into other;
 insert into public.chat_members(chat_id,user_id) values(other,a);
 perform pg_temp.act(a);
 select * into r from public.get_history_window(c,'latest');
 perform pg_temp.check('empty history is checked entirely', r.message_ids='{}' and not r.has_before and not r.has_after and r.lower_seq is null and r.upper_seq is null);
 for n in 1..31 loop
   perform public.send_media_message(c,'row '||n,null);
   if n in (1,30,31) then
     select * into r from public.get_history_window(c,'latest');
     perform pg_temp.check('size '||n, cardinality(r.message_ids)=least(n,30) and r.has_before=(n>30) and not r.has_after);
   end if;
 end loop;
 select array_agg(id order by seq),array_agg(seq order by seq) into ids,seqs from public.message_rows where chat_id=c;
 foreach i in array array[1,16,31] loop
   select * into r from public.get_history_window(c,'around',10,ids[i],1);
   perform pg_temp.check('around target '||i, cardinality(r.message_ids)=10 and r.anchor_seq=seqs[i]
     and (select count(*) from unnest(r.message_ids) z where z=ids[i])=1);
 end loop;
 select * into r from public.get_history_window(c,'around',1,ids[16]);
 perform pg_temp.check('limit includes target',r.message_ids=array[ids[16]] and r.has_before and r.has_after);

 seen := '{}';
 select * into r from public.get_history_window(c,'latest',7);
 loop
   seen := r.message_ids || seen;
   exit when not r.has_before;
   select * into r from public.get_history_window(c,'before',7,p_cursor=>pg_temp.cursor(c,'before',r.before_seq));
 end loop;
 perform pg_temp.check('backward traversal exact',seen=ids);
 seen := '{}';
 select * into r from public.get_history_window(c,'after',7,p_cursor=>pg_temp.cursor(c,'after',0));
 loop
   seen := seen || r.message_ids;
   exit when not r.has_after;
   select * into r from public.get_history_window(c,'after',7,p_cursor=>pg_temp.cursor(c,'after',r.after_seq));
 end loop;
 perform pg_temp.check('forward traversal exact',seen=ids);
 select * into r from public.get_history_window(c,'before',7,p_cursor=>pg_temp.cursor(c,'before',0));
 perform pg_temp.check('zero boundary reverses with a valid cursor',r.message_ids='{}' and r.after_seq=0);
 select * into r from public.get_history_window(c,'before',7,p_cursor=>pg_temp.cursor(c,'before',seqs[1]));
 perform pg_temp.check('empty before has terminal direction and exclusive coverage',r.message_ids='{}' and r.before_seq is null and r.upper_seq=seqs[1] and not r.upper_inclusive);
 select * into x from public.get_history_window(c,'after',7,p_cursor=>pg_temp.cursor(c,'after',r.after_seq));
 perform pg_temp.check('empty before reverse includes input boundary',x.message_ids[1]=ids[1]);
 select * into r from public.get_history_window(c,'after',7,p_cursor=>pg_temp.cursor(c,'after',seqs[31]));
 perform pg_temp.check('empty after has terminal direction',r.message_ids='{}' and r.after_seq is null and r.lower_seq=seqs[31] and not r.lower_inclusive);
 select * into x from public.get_history_window(c,'before',7,p_cursor=>pg_temp.cursor(c,'before',r.before_seq));
 perform pg_temp.check('empty after reverse includes input boundary',x.message_ids[cardinality(x.message_ids)]=ids[31]);

 gone:=ids[16];
 perform public.delete_messages(array[gone]);
 select * into r from public.get_history_window(c,'around',10,gone);
 perform pg_temp.check('deleted target without hint unavailable',r.target_status='unavailable' and r.message_ids='{}' and r.anchor_id is null);
 select * into r from public.get_history_window(c,'around',10,gone,seqs[16]);
 perform pg_temp.check('deleted target substitutes next',r.target_status='substituted' and r.anchor_id=ids[17] and not gone=any(r.message_ids));
 select * into r from public.get_history_window(c,'around',10,gen_random_uuid(),seqs[31]+1000);
 perform pg_temp.check('missing target beyond end substitutes previous',r.anchor_id=ids[31]);
 outsider := public.send_media_message(other,'other chat secret',null);
 select * into r from public.get_history_window(c,'around',10,outsider);
 perform pg_temp.check('foreign target indistinguishable',r.target_status='unavailable' and r.anchor_id is null);

 -- All raw fixture mutations use the session owner; requests use authenticated.
 perform set_config('role','supabase_admin',true);
 update public.messages set public_at=now()+interval '1 day' where id=ids[20];
 perform pg_temp.act(v);
 select * into r from public.get_history_window(c,'around',10,ids[20]);
 perform pg_temp.check('unpublished target has no leaked position',r.target_status='unavailable' and r.anchor_seq is null);
 select * into r from public.get_history_window(c,'around',10,ids[20],seqs[20]);
 perform pg_temp.check('watermark skips unpublished tail',r.anchor_id=ids[19] and not ids[20]=any(r.message_ids));
 select * into r from public.get_history_window(c,'latest',100);
 perform pg_temp.check('outsider respects deletion and publication',cardinality(r.message_ids)=18);
 select array_agg(id order by seq) into seen from public.message_rows where chat_id=c;
 select * into r from public.get_history_window(c,'after',3,p_cursor=>pg_temp.cursor(c,'after',0));
 ids := '{}';
 loop
   ids := ids || r.message_ids;
   exit when not r.has_after;
   select * into r from public.get_history_window(c,'after',3,p_cursor=>pg_temp.cursor(c,'after',r.after_seq));
 end loop;
 perform pg_temp.check('forward traversal across deletion and watermark',ids=seen);
 select * into r from public.get_history_window(c,'latest',3);
 ids := '{}';
 loop
   ids := r.message_ids || ids;
   exit when not r.has_before;
   select * into r from public.get_history_window(c,'before',3,p_cursor=>pg_temp.cursor(c,'before',r.before_seq));
 end loop;
 perform pg_temp.check('backward traversal across deletion and watermark',ids=seen);
 perform pg_temp.act(b);
 select * into r from public.get_history_window(c,'latest',100);
 perform pg_temp.check('member sees unpublished tail',cardinality(r.message_ids)=30);

 perform pg_temp.act(a);
 channel := (public.create_channel('Window channel','window_contract_zz')->>'chat_id')::uuid;
 secret := public.send_media_message(channel,'channel post',null);
 perform pg_temp.act(v);
 select * into r from public.get_history_window(channel,'around',30,secret);
 perform pg_temp.check('channel reader sees post',r.target_status='found' and r.message_ids=array[secret]);
 perform pg_temp.act(a);
 select * into r from public.get_history_window(channel,'around',30,secret);
 perform pg_temp.check('channel publisher sees post',r.target_status='found');

 -- Blocking keeps safe placeholders in history but cannot resolve a target.
 perform public.block_user(v);
 perform pg_temp.act(v);
 select * into r from public.get_history_window(c,'around',10,ids[5]);
 perform pg_temp.check('hidden target without hint unavailable',r.target_status='unavailable');
 select * into r from public.get_history_window(c,'around',10,ids[5],seqs[5]);
 perform pg_temp.check('only placeholders do not produce false empty coverage',r.target_status='empty'
   and r.anchor_id is null and cardinality(r.message_ids)=10);
 perform pg_temp.check('hidden contents absent',not exists(
   select 1 from public.history_window_messages(r) m where m.text is not null or not m.hidden));
 perform pg_temp.act(b);
 hidden := public.send_media_message(c,'visible replacement',null);
 perform pg_temp.act(v);
 select * into r from public.get_history_window(c,'around',10,ids[5],seqs[5]);
 -- B's new row is also above the watermark; remove that fixture-only hold.
 perform set_config('role','supabase_admin',true);
 update public.messages set public_at=created_at where chat_id=c;
 perform pg_temp.act(v);
 select * into r from public.get_history_window(c,'around',10,ids[5],seqs[5]);
 perform pg_temp.check('hidden target substitutes next available author',r.target_status='substituted' and r.anchor_id=hidden);
 perform pg_temp.act(a);

 -- Cursor is a coordinate scoped to chat and direction, never an identity.
 for i in 1..7 loop
   begin
     if i=1 then perform public.get_history_window(c,'before',p_cursor=>pg_temp.cursor(other,'before',seqs[1]));
     elsif i=2 then perform public.get_history_window(c,'before',p_cursor=>pg_temp.cursor(c,'after',seqs[1]));
     elsif i=3 then perform public.get_history_window(c,'latest',101);
     elsif i=4 then perform public.get_history_window(c,'around');
     elsif i=5 then perform public.get_history_window(c,'latest',p_target=>ids[1]);
     elsif i=6 then perform public.get_history_window(c,'before',p_cursor=>'{}');
     else perform public.get_history_window(c,'before',p_cursor=>jsonb_build_object('chatId',c,'direction','before','seq',1.5)); end if;
     raise exception 'FAIL: invalid request % accepted',i;
   exception when invalid_parameter_value then null;
   end;
 end loop;
 perform pg_temp.check('invalid requests rejected',true);

 perform set_config('role','supabase_admin',true);
 select last_read_at into start_read from public.chat_members where chat_id=c and user_id=a;
 perform pg_temp.act(a);
 perform public.get_history_window(c,'latest');
 perform public.get_history_window(c,'around',30,ids[1]);
 perform set_config('role','supabase_admin',true);
 select last_read_at into final_read from public.chat_members where chat_id=c and user_id=a;
 perform pg_temp.check('read boundary unchanged', start_read is not distinct from final_read);
 perform pg_temp.check('snapshot functions are stable invokers',
   (select bool_and(provolatile='s' and not prosecdef) from pg_proc where oid in
   ('public.get_history_window(uuid,text,integer,uuid,bigint,jsonb)'::regprocedure,
    'public.history_window_messages(public.history_window_rows)'::regprocedure)));
end;
$$;
rollback;
