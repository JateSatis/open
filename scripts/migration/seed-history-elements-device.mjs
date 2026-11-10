// Separate, persistent phone fixtures. Does not change existing test histories.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { runSql } from './psql-transport.mjs';

const source = randomUUID(),
  chat = randomUUID();
const result = runSql(
  `
begin;
create temporary table fixture_result(payload jsonb);
do $$
declare actor uuid; channel jsonb; posts uuid; originals uuid[]; destination uuid; n integer;
begin
 select owner_id into strict actor from public.channels where title='Test Kanal' and deleted_at is null;
 insert into public.chats(id,kind,created_by,owner_id,title,founding_member_ids) values
 ('${source}','group',actor,actor,'History elements source',array[actor]),
 ('${chat}','group',actor,actor,'History elements chat',array[actor]);
 insert into public.chat_members(chat_id,user_id) values('${source}',actor),('${chat}',actor);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 channel:=public.create_channel('History elements channel','hist_elements_${chat.slice(0, 8)}');
 posts:=(channel->>'chat_id')::uuid;
 insert into public.messages(chat_id,author_id,kind,text)
 select '${source}',actor,'text','history-item-'||lpad(g.num::text,3,'0')||E'\nПроверка частичной пересылки, элемент '||g.num from generate_series(1,100)g(num);
 select array_agg(id order by seq) into originals from public.messages where chat_id='${source}' and kind='text';
 foreach destination in array array['${chat}'::uuid,posts] loop
   for n in 1..3 loop
     perform public.send_media_message(destination,'history-group-'||n||' begins',null);
     perform public.forward_messages(destination,'${source}',originals);
   end loop;
 end loop;
 insert into fixture_result values(jsonb_build_object('source','${source}','chat','${chat}','channel',channel->>'channel_id','posts',posts));
end $$;
select payload from fixture_result;
commit;
`,
  { capture: true },
);
mkdirSync('.backup', { recursive: true });
writeFileSync(
  '.backup/history-elements-device.json',
  result.split(/\r?\n/).find((line) => line.startsWith('{')) + '\n',
);
console.log(result);
