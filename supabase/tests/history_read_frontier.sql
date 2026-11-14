-- Run with psql ON_ERROR_STOP. All fixtures and the legacy marker inputs roll back.
begin;
do $$
declare a uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  c uuid:=gen_random_uuid(); src uuid:=gen_random_uuid(); ids uuid[]; f uuid; mid record; tail record;
  first_row record; result record; stamp timestamptz; ch jsonb; dest uuid; member boolean;
begin
  insert into auth.users(id,email,raw_user_meta_data,aud,role)
    select u,'read-'||u||'@test.local','{}','authenticated','authenticated' from unnest(array[a,r,outsider]) u;
  update privacy_settings set public_message_visibility_delay='off' where user_id in (a,r,outsider);
  insert into chats(id,kind,created_by,owner_id,title,founding_member_ids)
    select id,'group',a,a,'Read frontier test',array[a] from unnest(array[c,src]) id;
  insert into chat_members(chat_id,user_id) values(c,a),(src,a),(c,r);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  ch:=create_channel('Read frontier test','read_'||left(c::text,8));
  insert into messages(chat_id,author_id,kind,text) select src,a,'text','original '||n from generate_series(1,4)n;
  select array_agg(id order by seq) into ids from messages where chat_id=src and kind='text';
  foreach dest in array array[c,(ch->>'chat_id')::uuid] loop
    member:=dest=c;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',r,'role','authenticated')::text,true);
    if not member then perform subscribe_to_channel((ch->>'channel_id')::uuid,true); end if;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
    f:=forward_messages(dest,src,ids);
    perform send_media_message(dest,'tail',null);
    select * into tail from messages where chat_id=dest and text='tail';
    select m.seq,i.id,i.position into mid from messages m join forward_items i on i.forward_id=m.id where m.id=f order by i.position offset 1 limit 1;
    -- Distinct times even though the fixture lives in a single transaction.
    update messages set created_at=now()-interval '2 min',public_at=now()-interval '2 min' where id=f;
    update messages set created_at=now()-interval '1 min',public_at=now()-interval '1 min' where id=tail.id;
    stamp:=now()-interval '90 seconds';
    assert legacy_read_seq(dest,stamp,member)=mid.seq,'legacy unread tail lost';
    assert legacy_read_seq(dest,now(),member)=tail.seq,'fully read history reopened';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',r,'role','authenticated')::text,true);
    select * into result from advance_history_read(dest,mid.seq,mid.position,mid.id,r);
    assert (result.read_seq,result.read_position)=(mid.seq,mid.position);
    select * into first_row from history_read_state(dest);
    assert (first_row.first_seq,first_row.first_position)=(mid.seq,mid.position+1),'partial forward skipped';
    if not member then assert (select unread_posts from my_channel_subscriptions((ch->>'channel_id')::uuid))=2; end if;
    select * into result from advance_history_read(dest,tail.seq,0,tail.id,r);
    select * into result from advance_history_read(dest,mid.seq,mid.position,mid.id,r);
    assert (result.read_seq,result.read_position)=(tail.seq,0),'late retry regressed';
    update messages set deleted_at=now() where id=tail.id;
    select * into first_row from history_read_state(dest);
    assert first_row.read_seq=tail.seq and first_row.first_seq is null,'deleted boundary lost';
    raise notice 'member=% partial=(%,%) first=(%,%) final=(%,0)',member,mid.seq,mid.position,mid.seq,mid.position+1,tail.seq;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
    assert not exists(select 1 from history_read_state(dest));
    begin perform advance_history_read(dest,mid.seq,mid.position,mid.id,r); raise exception 'incorrect reader accepted';
    exception when insufficient_privilege then null; end;
    if member then
      perform subscribe_to_chat(dest);
      select * into first_row from history_read_state(dest);
      assert found;
      begin perform advance_history_read(dest,mid.seq,mid.position,ids[1],outsider); raise exception 'wrong occurrence accepted';
      exception when invalid_parameter_value then null; end;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
      perform send_media_message(dest,'subscription tail',null);
      select * into strict tail from messages where chat_id=dest and text='subscription tail';
      perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
      select * into first_row from history_read_state(dest);
      assert first_row.first_seq=tail.seq,'subscriber cannot see incoming tail';
      assert (select unread_posts from my_subscriptions(dest))=1;
      select * into result from advance_history_read(dest,tail.seq,0,tail.id,outsider);
      assert (result.read_seq,result.read_position)=(tail.seq,0);
      assert (select unread_posts from my_subscriptions(dest))=0;
      assert not exists(select 1 from chat_members where chat_id=dest and user_id=outsider);
    end if;
  end loop;
end $$;
rollback;

