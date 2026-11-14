// Run with TARGET_SSH_HOST or TARGET_DB_URL. Two independent authenticated
// transactions advance an isolated membership. The second must block, then
// re-evaluate its UPDATE predicate against the newer committed coordinate.
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { runSql } from './psql-transport.mjs';

if (process.argv[2] === 'writer') {
  process.once('message', (sql) => {
    try {
      process.send(runSql(sql, { capture: true, timeout: 25000 }));
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
    process.disconnect();
  });
} else {
  const id = randomUUID(),
    reader = randomUUID();
  const sql = (s) => runSql(s, { capture: true, timeout: 20000 });
  const writer = (s) =>
    new Promise((resolve, reject) => {
      let out;
      const child = fork(fileURLToPath(import.meta.url), ['writer'], { windowsHide: true });
      child.once('message', (r) => {
        out = r;
      });
      child.once('error', reject);
      child.once('exit', (c) => (c === 0 ? resolve(out) : reject(Error('Writer failed'))));
      child.send(s);
    });
  const tag = 'frontier-' + id;
  try {
    const rows =
      sql(`begin;insert into auth.users(id,email,raw_user_meta_data,aud,role) values('${reader}','race-${reader}@test.local','{}','authenticated','authenticated');
      insert into chats(id,kind,created_by,owner_id,title,founding_member_ids) values('${id}','group','${reader}','${reader}','Read race',array['${reader}']::uuid[]);
      insert into chat_members(chat_id,user_id) values('${id}','${reader}');
      insert into messages(chat_id,author_id,kind,text) values('${id}','${reader}','text','1'),('${id}','${reader}','text','2');
      select seq,id from messages where chat_id='${id}' and kind='text' order by seq;commit;`)
        .split(/\r?\n/)
        .filter((l) => /^\d+\|/.test(l))
        .map((l) => l.split('|'));
    assert.equal(rows.length, 2);
    const write = (
      [seq, key],
      hold,
    ) => `begin;set local application_name='${tag}';set local role authenticated;select set_config('request.jwt.claims','{"sub":"${reader}","role":"authenticated"}',true);
      select read_seq,read_position from advance_history_read('${id}',${seq},0,'${key}','${reader}');
      ${hold ? 'select pg_sleep(8);' : ''} commit;`;
    const late = writer(write(rows[1], true));
    let sleeping = false;
    for (let i = 0; i < 8 && !sleeping; i++) {
      sleeping =
        sql(
          `select exists(select 1 from pg_stat_activity where application_name='${tag}' and wait_event='PgSleep')`,
        ) === 't';
    }
    assert.ok(sleeping, 'first transaction must still own the row lock');
    const early = writer(write(rows[0], false));
    const [a, b] = await Promise.all([late, early]);
    for (const value of [a, b]) assert.ok(value.split(/\r?\n/).includes(rows[1][0] + '|0'));
    assert.equal(
      sql(`select read_seq,read_position from chat_members where chat_id='${id}'`),
      rows[1][0] + '|0',
    );
    console.log(
      'Concurrent writers: early=' +
        rows[0][0] +
        ' later=' +
        rows[1][0] +
        ' both confirmed ' +
        rows[1][0] +
        '|0',
    );
  } finally {
    sql(
      `begin;delete from messages where chat_id='${id}';delete from chats where id='${id}';delete from auth.users where id='${reader}';commit;`,
    );
  }
}
