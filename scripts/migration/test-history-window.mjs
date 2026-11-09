// Real HTTP, MVCC concurrency and query-plan checks. Creates isolated fixtures;
// finally removes only this run's UUIDs. Requires VPS DB access (see backend.md).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import pg from 'pg';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
mkdirSync('.backup', { recursive: true });

const env = Object.fromEntries(
  readFileSync('infra/.env', 'utf8')
    .split(/\r?\n/)
    .filter((x) => /^[A-Z_]+=/.test(x))
    .map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1).trim()]),
);
const config = process.env.TARGET_DB_URL
  ? { connectionString: process.env.TARGET_DB_URL }
  : {
      host: '127.0.0.1',
      port: 55432,
      user: 'supabase_admin',
      password: env.POSTGRES_PASSWORD,
      database: 'postgres',
    };
const db = new pg.Client(config);
const writer = new pg.Client(config);
const ids = {
  author: randomUUID(),
  viewer: randomUUID(),
  chat: randomUUID(),
  source: randomUUID(),
};
const results = [];
const log = (x) => {
  results.push(x);
  console.log(JSON.stringify(x));
};
const token = (uid) => {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ role: 'authenticated', sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  return `${head}.${body}.${createHmac('sha256', env.JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
};
let wire;
const client = (uid) =>
  createClient(`https://${env.API_DOMAIN}`, env.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token(uid)}` },
      fetch: async (url, options) => {
        const start = performance.now();
        const local = process.env.HISTORY_TEST_REST_URL
          ? String(url).replace(
              `https://${env.API_DOMAIN}/rest/v1`,
              process.env.HISTORY_TEST_REST_URL,
            )
          : url;
        const response = await fetch(local, { ...options, signal: AbortSignal.timeout(120000) });
        const text = await response.clone().text();
        wire = {
          bytes: Buffer.byteLength(text),
          ms: Math.round(performance.now() - start),
          body: JSON.parse(text),
        };
        return response;
      },
    },
  });
let current = client(ids.author);
const cache = new Map();
function load(path) {
  if (path === '@/api/supabase') return { supabase: current };
  const file = resolve(path.startsWith('@/') ? 'src/' + path.slice(2) + '.ts' : path);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', js)(
    (p) => (p.startsWith('@/') ? load(p) : createRequire(file)(p)),
    exports,
  );
  return exports;
}
const api = () => {
  cache.clear();
  return load('@/api/historyWindow');
};
await db.connect();
await writer.connect();
try {
  await db.query('begin');
  for (const [key, uid] of [
    ['author', ids.author],
    ['viewer', ids.viewer],
  ]) {
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data,aud,role) values($1,$2,'{}','authenticated','authenticated')",
      [uid, `history-${key}-${uid}@test.local`],
    );
  }
  await db.query(
    "update public.privacy_settings set public_message_visibility_delay='off', profile_identity_masking='everyone',dialogue_participant_name_masking='everyone',dialogue_media_visibility='everyone' where user_id=any($1)",
    [[ids.author, ids.viewer]],
  );
  for (const chat of [ids.chat, ids.source]) {
    await db.query(
      "insert into public.chats(id,kind,created_by,owner_id,title,founding_member_ids) values($1,'group',$2,$2,'History window HTTP fixture',array[$2]::uuid[])",
      [chat, ids.author],
    );
    await db.query('insert into public.chat_members(chat_id,user_id) values($1,$2)', [
      chat,
      ids.author,
    ]);
  }
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: ids.author, role: 'authenticated' }),
  ]);
  await db.query(
    "insert into public.messages(chat_id,author_id,kind,text) select $1,$2,'text',repeat('Длинный текст ',80)||n from generate_series(1,1101)n",
    [ids.source, ids.author],
  );
  await db.query(
    "insert into public.messages(chat_id,author_id,kind,text) select $1,$2,'text','history '||n from generate_series(1,301)n",
    [ids.chat, ids.author],
  );
  const path = `${ids.author}/history-window.jpg`;
  await db.query(
    "insert into public.media_objects(bucket,path,owner_id,kind,mime_type,size_bytes) values('chat-media',$1,$2,'photo','image/jpeg',10)",
    [path, ids.author],
  );
  await db.query('set local role authenticated');
  const media = (
    await db.query('select public.send_media_message($1,$2,$3::jsonb) id', [
      ids.chat,
      'media fixture',
      JSON.stringify([{ url: path, mime_type: 'image/jpeg', width: 800, height: 600 }]),
    ])
  ).rows[0].id;
  const quote = (
    await db.query('select public.send_media_message($1,$2,null,array[$3]::uuid[]) id', [
      ids.chat,
      'quote fixture',
      media,
    ])
  ).rows[0].id;
  const originals = (
    await db.query('select id from public.message_rows where chat_id=$1 order by seq', [ids.source])
  ).rows.map((x) => x.id);
  let forward;
  for (let i = 0; i < Number(process.env.HISTORY_TEST_FORWARD_COUNT ?? 1); i++)
    forward = (
      await db.query('select public.forward_messages($1,$2,$3::uuid[]) id', [
        ids.chat,
        ids.source,
        originals.slice(0, 100),
      ])
    ).rows[0].id;
  await db.query('commit');
  writeFileSync('.backup/history-window-fixture-ids.json', JSON.stringify(ids));
  log({
    fixture: 'created',
    sourceMessages: 1101,
    historyMessages: 303 + Number(process.env.HISTORY_TEST_FORWARD_COUNT ?? 1),
  });

  for (const uid of [ids.author, ids.viewer]) {
    current = client(uid);
    const { getHistoryWindow } = api();
    const window = await getHistoryWindow(ids.chat, { mode: 'around', messageId: forward });
    const measurement = { ...wire };
    delete measurement.body;
    const item = window.items.find((x) => x.id === forward);
    assert.equal(item.forward.items.length, 100);
    assert.equal(
      window.items.filter((x) => x.forward).length,
      Math.min(30, Number(process.env.HISTORY_TEST_FORWARD_COUNT ?? 1)),
    );
    assert.equal(
      window.items.flatMap((x) => x.forward?.items ?? []).length,
      Math.min(30, Number(process.env.HISTORY_TEST_FORWARD_COUNT ?? 1)) * 100,
    );
    assert.equal(item.forward.items.filter((x) => x.original?.text).length, 100);
    assert.equal(window.items.find((x) => x.id === media).attachments.length, 1);
    assert.equal(window.items.find((x) => x.id === quote).replies[0].state, 'live');
    log({
      test: 'full HTTP representation',
      viewer: uid === ids.author ? 'member' : 'outsider',
      ...measurement,
      forwardItems: item.forward.items.length,
    });
    const projection = load('@/api/messageRows');
    const { data, error } = await current
      .from('message_rows')
      .select(projection.MESSAGE_COLUMNS)
      .in(
        'id',
        window.items.map((x) => x.id),
      )
      .order('seq');
    if (error) throw error;
    assert.deepEqual(window.items, data.map(projection.toMessage));
    log({
      test: 'new and existing presentation identical',
      viewer: uid === ids.author ? 'member' : 'outsider',
    });
  }
  current = client(ids.author);
  const { getHistoryWindow } = api();
  const expected = (
    await db.query('select id from messages where chat_id=$1 and deleted_at is null order by seq', [
      ids.chat,
    ])
  ).rows.map((x) => x.id);
  let page = await getHistoryWindow(ids.chat, { mode: 'latest', limit: 100 });
  let walked = page.items.map((x) => x.id);
  while (page.before) {
    page = await getHistoryWindow(ids.chat, { mode: 'before', cursor: page.before, limit: 100 });
    walked = page.items.map((x) => x.id).concat(walked);
  }
  assert.deepEqual(walked, expected);
  page = await getHistoryWindow(ids.chat, {
    mode: 'after',
    cursor: { chatId: ids.chat, direction: 'after', seq: 0 },
    limit: 100,
  });
  walked = page.items.map((x) => x.id);
  while (page.after) {
    page = await getHistoryWindow(ids.chat, { mode: 'after', cursor: page.after, limit: 100 });
    walked.push(...page.items.map((x) => x.id));
  }
  assert.deepEqual(walked, expected);
  log({ test: 'HTTP traversal both directions', messages: walked.length });
  await db.query('begin');
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: ids.author, role: 'authenticated' }),
  ]);
  await db.query('set local role authenticated');
  const helper = (
    await db.query(
      'select count(*)::int n from history_window_messages(json_populate_record(null::history_window_rows,$1::json))',
      [JSON.stringify({ chat_id: ids.source, message_ids: originals })],
    )
  ).rows[0];
  await db.query('rollback');
  assert.equal(helper.n, 100);
  log({ test: 'direct SQL helper also caps top-level rows', rows: helper.n });

  await getHistoryWindow(ids.source, { mode: 'around', messageId: originals[550] });
  log({
    test: 'plain window on long history',
    historyMessages: 1101,
    rows: 30,
    bytes: wire.bytes,
    ms: wire.ms,
  });

  await db.query('begin');
  await db.query(
    "update messages set text='PRIVATE_HISTORY_TEXT public',hidden_ranges='{[0,20)}'::int4multirange where id=$1",
    [originals[0]],
  );
  await db.query(
    "update privacy_settings set dialogue_media_visibility='friends',profile_identity_masking='friends',dialogue_participant_name_masking='friends' where user_id=$1",
    [ids.author],
  );
  await db.query('commit');
  current = client(ids.viewer);
  const restricted = await api().getHistoryWindow(ids.chat, { mode: 'around', messageId: forward });
  const raw = JSON.stringify(wire.body);
  assert(!raw.includes('PRIVATE_HISTORY_TEXT'));
  assert(!raw.includes(path));
  assert(!raw.includes(ids.author));
  assert.equal(restricted.items.find((x) => x.id === media).attachments[0].hidden, true);
  assert.equal(restricted.items.find((x) => x.id === quote).replies[0].state, 'live');
  log({ test: 'raw HTTP protects nested original text, quoted media and author identity' });
  current = client(ids.author);

  // A gate after envelope calculation permits a concurrent committed edit,
  // deletion and insert before the nested representation is read.
  await writer.query('select pg_advisory_lock(91827364)');
  await db.query('begin');
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: ids.author, role: 'authenticated' }),
  ]);
  await db.query('set local role authenticated');
  const pid = (await db.query('select pg_backend_pid() pid')).rows[0].pid;
  const pending = db.query(
    `with w as materialized(select * from get_history_window($1,'around',3,$2)),
    gate as materialized(select pg_advisory_xact_lock(91827364) from w)
    select to_jsonb(w) envelope,(select jsonb_agg(to_jsonb(m) order by m.seq) from history_window_messages(w)m) items
    from w cross join gate`,
    [ids.chat, quote],
  );
  for (let i = 0; i < 100; i++) {
    const state = (
      await writer.query('select wait_event from pg_stat_activity where pid=$1', [pid])
    ).rows[0];
    if (state?.wait_event === 'advisory') break;
    if (i === 99) throw Error('Snapshot gate was not reached');
    await new Promise((r) => setTimeout(r, 100));
  }
  await writer.query('begin');
  await writer.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: ids.author, role: 'authenticated' }),
  ]);
  await writer.query(
    "update messages set text='concurrent changed', deleted_at=now() where id=$1",
    [quote],
  );
  await writer.query(
    "insert into messages(chat_id,author_id,kind,text) values($1,$2,'text','concurrent new')",
    [ids.chat, ids.author],
  );
  await writer.query('commit');
  await writer.query('select pg_advisory_unlock(91827364)');
  const snapshot = (await pending).rows[0];
  await db.query('rollback');
  assert.equal(snapshot.items.find((x) => x.id === quote).text, 'quote fixture');
  assert.deepEqual(
    snapshot.items.map((x) => x.id),
    snapshot.envelope.message_ids,
  );
  assert(!snapshot.items.some((x) => x.text === 'concurrent new'));
  if (Number(process.env.HISTORY_TEST_FORWARD_COUNT ?? 1) === 1) {
    assert.equal(snapshot.envelope.has_after, false);
    assert.equal(snapshot.envelope.upper_seq, null);
  }
  log({
    test: 'concurrent edit/delete/insert keeps envelope and rows on original statement snapshot',
  });

  await db.query('begin');
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: ids.author, role: 'authenticated' }),
  ]);
  await db.query('set local role authenticated');
  const plan = (
    await db.query(
      'explain (analyze,buffers,format json) select id,seq from message_rows where chat_id=$1 and seq < (select max(seq) from message_rows where chat_id=$1) order by seq desc limit 31',
      [ids.chat],
    )
  ).rows[0]['QUERY PLAN'];
  await db.query('rollback');
  writeFileSync('.backup/history-window-plan.json', JSON.stringify(plan, null, 2));
  assert(JSON.stringify(plan).includes('messages_chat_seq_idx'));
  log({
    test: 'keyset plan',
    index: 'messages_chat_seq_idx',
    executionMs: plan[0]['Execution Time'],
  });
} finally {
  await writer.query('rollback');
  await writer.query('select pg_advisory_unlock_all()');
  await db.query('rollback');
  // Only UUIDs generated by this run, never existing user chats/fixtures.
  await db.query('begin');
  await db.query('delete from public.chats where id=any($1)', [[ids.chat, ids.source]]);
  await db.query('delete from public.media_objects where owner_id=any($1)', [
    [ids.author, ids.viewer],
  ]);
  await db.query('delete from auth.users where id=any($1)', [[ids.author, ids.viewer]]);
  await db.query('commit');
  log({
    fixture: 'removed',
    remainingChats: (
      await db.query('select count(*) n from chats where id=any($1)', [[ids.chat, ids.source]])
    ).rows[0].n,
  });
  writeFileSync('.backup/history-window-results.json', JSON.stringify(results, null, 2));
  await db.end();
  await writer.end();
}
