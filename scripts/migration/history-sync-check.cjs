/* global config */
// Run via test-history-elements.mjs --sync[-baseline]. No realtime subscription.
const { Buffer } = require('node:buffer');
const { Client } = require('pg');
const { randomUUID, createHmac } = require('node:crypto');
const assert = require('node:assert/strict');
async function main() {
  const connect = async () => {
    const c = new Client({
      host: 'db',
      database: 'postgres',
      user: 'supabase_admin',
      password: config.password,
    });
    await c.connect();
    return c;
  };
  const db = await connect(),
    writer = await connect();
  const author = randomUUID(),
    reader = randomUUID(),
    chat = randomUUID(),
    source = randomUUID();
  let other, channelId;
  let noiseWriter;
  const log = (name, value) => console.log(JSON.stringify({ name, value }));
  const one = async (c, sql, args) => (await c.query(sql, args)).rows[0];
  async function auth(c, user, local = false) {
    await c.query("select set_config('request.jwt.claims',$1,$2)", [
      JSON.stringify({ sub: user, role: 'authenticated' }),
      local,
    ]);
    await c.query(local ? 'set local role authenticated' : 'set role authenticated');
  }
  function token(user) {
    const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const data =
      enc({ alg: 'HS256', typ: 'JWT' }) +
      '.' +
      enc({ sub: user, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
    return data + '.' + createHmac('sha256', config.secret).update(data).digest('base64url');
  }
  async function rpc(name, args, user = reader, packed = true) {
    const columns = config.syncBaseline
      ? config.packedColumns.replace('sync_cursor,', '')
      : config.packedColumns;
    const query = packed
      ? '?select=' +
        encodeURIComponent(columns) +
        config.uniqueEmbeds.map((p) => '&' + p + '.limit=1').join('')
      : '';
    const res = await fetch('http://rest:3000/rpc/' + name + query, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token(user),
        'Content-Type': 'application/json',
        Accept: packed ? 'application/vnd.pgrst.object+json' : 'application/json',
      },
      body: JSON.stringify(args),
    });
    const value = await res.json();
    if (!res.ok) throw Error(name + ' ' + res.status + ' ' + JSON.stringify(value));
    return value;
  }
  try {
    await db.query('begin');
    for (const u of [author, reader])
      await db.query(
        "insert into auth.users(id,email,raw_user_meta_data,aud,role) values($1,$2,'{}','authenticated','authenticated')",
        [u, 'journal-' + u + '@test.local'],
      );
    await db.query(
      "update privacy_settings set public_message_visibility_delay='off' where user_id=any($1)",
      [[author, reader]],
    );
    for (const id of [chat, source]) {
      await db.query(
        "insert into chats(id,kind,created_by,owner_id,title,founding_member_ids) values($1,'group',$2,$2,'History journal test',array[$2]::uuid[])",
        [id, author],
      );
      await db.query('insert into chat_members(chat_id,user_id) values($1,$2)', [id, author]);
    }
    await db.query(
      "insert into messages(chat_id,author_id,kind,text) select $1,$2,'text','original '||n from generate_series(1,100)n",
      [source, author],
    );
    const originals = (
      await db.query('select id from messages where chat_id=$1 order by seq', [source])
    ).rows.map((x) => x.id);
    await auth(db, author, true);
    const channel = (
      await one(db, "select create_channel('History journal', $1) data", [
        'journal_' + author.slice(0, 8),
      ])
    ).data;
    other = channel.chat_id;
    channelId = channel.channel_id;
    const forwardSql = 'select forward_messages($1,$2,$3::uuid[]) id';
    const group = (await one(db, forwardSql, [chat, source, originals])).id;
    const second = (await one(db, forwardSql, [other, source, originals])).id;
    await db.query('commit');
    await db.query(
      "insert into messages(chat_id,author_id,kind,text) select $1,$2,'text','ordinary '||n from generate_series(1,12)n",
      [chat, author],
    );
    const normal = (
      await db.query("select id from messages where chat_id=$1 and kind='text' order by seq", [
        chat,
      ])
    ).rows.map((x) => x.id);
    const args = { p_chat: chat, p_mode: 'around', p_target: normal[0], p_limit: 12 };
    const window = () => rpc('get_history_element_window', args);
    async function timing(name, fn) {
      const samples = [];
      for (let i = 0; i < 7; i++) {
        const start = performance.now();
        await fn();
        if (i) samples.push(+(performance.now() - start).toFixed(2));
      }
      log(name, {
        samples,
        median: (samples.toSorted((a, b) => a - b)[2] + samples.toSorted((a, b) => a - b)[3]) / 2,
      });
    }
    await timing('full window HTTP milliseconds', window);
    await auth(writer, author);
    async function writeCost(name, sql, params) {
      const samples = [];
      for (let i = 0; i < 7; i++) {
        await writer.query('begin');
        const plan = (await one(writer, 'explain (analyze,buffers,format json) ' + sql, params))[
          'QUERY PLAN'
        ][0];
        if (i) samples.push(plan['Execution Time']);
        await writer.query('rollback');
      }
      log(name + ' SQL execution ms', samples);
    }
    await writeCost('ordinary message', "select send_media_message($1,'benchmark','[]'::jsonb)", [
      chat,
    ]);
    await writeCost('forward 100', forwardSql, [chat, source, originals]);
    if (config.syncBaseline) return;

    const changes = (c, limit = 1, dest = chat, user = reader) =>
      rpc('get_history_changes', { p_chat: dest, p_cursor: c, p_limit: limit }, user, false);
    const range = (coverage, user = reader, limit = 100) =>
      rpc('get_history_range', { p_chat: chat, p_range: coverage, p_limit: limit }, user);
    const sendEdit = (id, text) => writer.query('select edit_message($1,$2)', [id, text]);
    const occurrenceRows = (w) =>
      w.parents
        .flatMap((parent) => {
          const children = w.forwards.filter((f) => f.forward_id === parent.id);
          return (children.length ? children : [null]).map((item) => ({
            key: item?.id ?? parent.id,
            parent,
            item,
          }));
        })
        .sort(
          (a, b) =>
            a.parent.seq - b.parent.seq || (a.item?.position ?? 0) - (b.item?.position ?? 0),
        );
    const rowKeys = (window) => occurrenceRows(window).map((row) => row.key);
    async function replace(ticket, cache, coverage) {
      if (ticket.status === 'reconcile' || ticket.status === 'expired') {
        const snapshot = await range(coverage);
        assert.deepEqual(snapshot.coverage, coverage);
        const visible = occurrenceRows(snapshot);
        cache.splice(0, cache.length, ...visible);
        return snapshot.sync_cursor;
      }
      return ticket.cursor;
    }
    await sendEdit(originals[99], 'SECRET FOR MEMBERS');
    await writer.query('select delete_messages(array[$1::uuid])', [originals[98]]);
    const saved = await window(),
      cache = occurrenceRows(saved);
    const also = await rpc('get_history_element_window', {
      p_chat: other,
      p_mode: 'latest',
      p_limit: 5,
    });
    assert.deepEqual(rowKeys(saved), saved.element_ids);
    assert.equal(cache.length, 12);
    assert.equal(saved.forwards.length, 5);
    assert.ok(saved.coverage.lower && saved.coverage.upper);
    assert.ok(saved.forwards.some((f) => f.original === null));
    assert.ok(JSON.stringify(cache).includes('SECRET FOR MEMBERS'));
    assert.equal((await changes(saved.sync_cursor)).status, 'current');
    // Removing an unloaded sibling cannot announce activity in this window.
    await writer.query('select remove_forward_items($1,array[$2::uuid])', [group, originals[0]]);
    assert.equal((await changes(saved.sync_cursor)).status, 'current');
    // Three independent commits after the reader saved its last snapshot.
    await sendEdit(normal[0], 'updated offline');
    await writer.query('select delete_messages(array[$1::uuid])', [normal[1]]);
    await writer.query('select set_message_hidden($1,0,6,true)', [originals[99]]);
    const first = await changes(saved.sync_cursor);
    assert.equal(first.status, 'more');
    assert.equal(first.parentIds.length, 1);
    // This commit is after the pass ceiling. It cannot extend the pass.
    await sendEdit(normal[2], 'after ceiling');
    const last = await changes(first.cursor);
    assert.equal(last.status, 'reconcile');
    assert.deepEqual(new Set([...first.parentIds, ...last.parentIds]), new Set([normal[0], group]));
    const refreshed = await replace(last, cache, saved.coverage);
    const fresh = await range(saved.coverage);
    assert.deepEqual(cache, occurrenceRows(fresh));
    // Independent oracle via ordinary navigation, clipped to the original coordinates.
    const wider = await rpc('get_history_element_window', { ...args, p_limit: 28 });
    const { lower, upper } = saved.coverage;
    const cmp = (r, b) => r.parent.seq - b.seq || (r.item?.position ?? 0) - b.position;
    const expected = occurrenceRows(wider).filter((r) => cmp(r, lower) >= 0 && cmp(r, upper) <= 0);
    assert.deepEqual(cache, expected);
    assert.equal(cache.length, 11);
    assert.ok(!cache.some((r) => r.key === normal[1]));
    assert.ok(cache.some((r) => r.parent.text === 'updated offline'));
    assert.ok(cache.some((r) => r.item?.original?.text === '•••••• FOR MEMBERS'));
    assert.ok(cache.some((r) => r.item && r.item.original === null));
    assert.ok(!JSON.stringify(cache).includes('SECRET'));
    await replace(first, cache, saved.coverage);
    await replace(last, cache, saved.coverage);
    assert.deepEqual(cache, expected);
    assert.deepEqual(await changes(first.cursor), last);
    assert.equal((await changes(refreshed)).status, 'current');
    const otherChanges = await changes(also.sync_cursor, 10, other);
    assert.deepEqual(otherChanges.parentIds, [second]);
    assert.equal(otherChanges.status, 'reconcile');
    assert.ok(JSON.stringify(await range(saved.coverage, author)).includes('SECRET FOR MEMBERS'));
    await assert.rejects(
      () => changes(saved.sync_cursor, 1, chat, author),
      /different reader or chat/,
    );
    await assert.rejects(() => changes(saved.sync_cursor, 1, other), /different reader or chat/);
    log('offline + replay PASS', {
      saved: 12,
      forwards: 5,
      now: cache.length,
      coverage: saved.coverage,
      pages: [first.status, last.status],
      sameOrderedContents: true,
      masked: true,
      deletedOriginalPlaceholder: true,
      secondDestination: true,
    });
    // A page can be consumed even when its last parent is no longer visible.
    const split = await changes(saved.sync_cursor);
    const seen = [...split.parentIds];
    let step = split;
    while (step.status === 'more') {
      step = await changes(step.cursor);
      seen.push(...step.parentIds);
    }
    assert.equal(seen.length, 3);
    const middle = seen[1];
    await db.query('begin');
    await db.query('update messages set deleted_at=now() where id=$1', [middle]);
    await auth(db, reader, true);
    const empty = (await one(db, 'select get_history_changes($1,$2,1) p', [chat, split.cursor])).p;
    assert.equal(empty.status, 'more');
    assert.deepEqual(empty.parentIds, []);
    assert.deepEqual(
      (await one(db, 'select get_history_changes($1,$2,1) p', [chat, empty.cursor])).p,
      { status: 'reconcile', cursor: null, parentIds: [seen[2]] },
    );
    await db.query('rollback');
    // Earlier xid stays open in the source. An independent destination writer
    // commits first; a new window then captures the hole in the xid sequence.
    await db.query('begin');
    const slow = (await one(db, 'select pg_current_xact_id()::text x')).x;
    await db.query("update messages set text='late commit' where id=$1", [originals[97]]);
    await writer.query('begin');
    const fast = (await one(writer, 'select pg_current_xact_id()::text x')).x;
    assert.ok(BigInt(slow) < BigInt(fast));
    await sendEdit(normal[0], 'earlier commit');
    await writer.query('commit');
    const intermediate = await window();
    assert.ok(!JSON.stringify(intermediate).includes('late commit'));
    await db.query('commit');
    const late = await changes(intermediate.sync_cursor);
    assert.equal(late.status, 'reconcile');
    assert.deepEqual(late.parentIds, [group]);
    const stable = await window();
    await db.query('begin');
    const rolled = (await one(db, 'select pg_current_xact_id()::text x')).x;
    await db.query("update messages set text='rolled back' where id=$1", [normal[0]]);
    await db.query('rollback');
    assert.equal(
      (await one(db, 'select count(*)::int n from history_sync.events where writer=$1', [rolled]))
        .n,
      0,
    );
    assert.equal((await changes(stable.sync_cursor)).status, 'current');
    log('reverse commit + rollback PASS', { slow, fast });
    // Pause a live reader statement after building its envelope and before hydration.
    const gate = (await one(db, 'select hashtext($1) n', [chat])).n;
    await writer.query('select pg_advisory_lock($1)', [gate]);
    await db.query('begin');
    await auth(db, reader, true);
    await db.query("set local statement_timeout='15s'");
    const pid = (await one(db, 'select pg_backend_pid() n')).n;
    const waiting = one(
      db,
      `with w as materialized(select * from get_history_element_window($1,'around',12,$2)),
      gate as materialized(select pg_advisory_xact_lock($3) from w)
      select w.sync_cursor,(select m.text from history_page_parents(w)m where m.id=$2) text from w cross join gate`,
      [chat, normal[0], gate],
    );
    try {
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = (await one(writer, 'select pg_backend_pid()=any(pg_blocking_pids($1)) b', [pid]))
          .b;
        if (!blocked) await new Promise((r) => setTimeout(r, 25));
      }
      assert.ok(blocked, 'reader reached snapshot barrier');
      await sendEdit(normal[0], 'committed during snapshot');
    } finally {
      await writer.query('select pg_advisory_unlock($1)', [gate]);
    }
    const snapshot = await waiting;
    await db.query('rollback');
    assert.equal(snapshot.text, 'earlier commit');
    assert.deepEqual((await changes(snapshot.sync_cursor)).parentIds, [normal[0]]);
    log('statement snapshot + next cursor PASS', true);
    await writer.query('select remove_forward_items($1,array[$2::uuid])', [group, originals[97]]);
    const afterRemoval = await changes(stable.sync_cursor, 100);
    assert.ok(afterRemoval.parentIds.includes(group));
    assert.ok(!(await range(saved.coverage)).forwards.some((f) => f.message_id === originals[97]));
    const until = await range(saved.coverage);
    const userVisibleBefore = await rpc(
      'get_history_element_window',
      { p_chat: source, p_mode: 'latest', p_limit: 5 },
      author,
    );
    await db.query("update messages set public_at=now()+interval '1 hour' where id=$1", [
      originals[95],
    ]);
    const restricted = await changes(until.sync_cursor);
    assert.equal(restricted.status, 'reconcile');
    const privateRange = await range(saved.coverage);
    assert.ok(!JSON.stringify(privateRange).includes(originals[99]));
    await sendEdit(originals[99], 'secret unpublished');
    const onlyPrivate = await changes(privateRange.sync_cursor);
    assert.deepEqual(onlyPrivate.parentIds, []);
    assert.equal(onlyPrivate.status, 'current');
    assert.ok(
      (await changes(userVisibleBefore.sync_cursor, 100, source, author)).parentIds.includes(
        originals[99],
      ),
    );
    await writer.query('begin');
    await assert.rejects(
      () => writer.query('select * from history_sync.events limit 1'),
      /permission denied/,
    );
    await writer.query('rollback');
    log('unpublished original + distinct reader permissions PASS', true);
    // READ COMMITTED sees the writer's commit but now() remains the reader's
    // transaction start. Reopen after publication without a sleep or another
    // message write. A viewer-only visibility transition must invalidate shape.
    await db.query('begin');
    await auth(db, reader, true);
    await writer.query('reset role');
    await writer.query('update messages set public_at=clock_timestamp() where id=$1', [
      originals[95],
    ]);
    await auth(writer, author);
    const beforePublication = await one(
      db,
      'select sync_cursor, element_ids from get_history_range($1,$2)',
      [chat, saved.coverage],
    );
    await db.query('commit');
    const released = await changes(beforePublication.sync_cursor);
    assert.equal(released.status, 'reconcile');
    assert.deepEqual(released.parentIds, []);
    assert.ok(
      (await range(saved.coverage)).element_ids.length > beforePublication.element_ids.length,
    );
    log('publication by elapsed time without message event PASS', true);
    await db.query(
      "update privacy_settings set message_activity_metadata_visibility='nobody' where user_id=$1",
      [reader],
    );
    const privateReads = await range(saved.coverage);
    assert.equal(privateReads.parents.find((m) => m.id === normal[0]).reads_visible, false);
    await db.query(
      'update messages set views_count=views_count+1,member_views_count=member_views_count+1,read_at=now() where id=$1',
      [normal[0]],
    );
    assert.deepEqual(occurrenceRows(await range(saved.coverage)), occurrenceRows(privateReads));
    assert.equal((await changes(privateReads.sync_cursor)).status, 'current');
    const latest = await rpc('get_history_element_window', {
      p_chat: chat,
      p_mode: 'latest',
      p_limit: 2,
    });
    const added = (
      await one(writer, "select send_media_message($1,'new ordinary','[]'::jsonb) id", [chat])
    ).id;
    const inserted = await changes(latest.sync_cursor);
    assert.deepEqual(inserted.parentIds, [added]);
    assert.equal(inserted.status, 'reconcile');
    assert.equal((await changes(privateReads.sync_cursor)).status, 'current');
    log('create + independent section + hidden read activity PASS', true);
    // Prune exactly one fixture row inside a rolled-back transaction.
    await writer.query('begin isolation level repeatable read');
    await writer.query('select pg_current_xact_id()');
    const prePrune = await range(saved.coverage);
    await db.query("update messages set text='expiry test' where id=$1", [normal[0]]);
    await db.query('begin');
    await db.query(
      `update history_sync.events set recorded_at='1800-01-01' where message_id=$1
      and writer=(select max(writer) from history_sync.events where message_id=$1)`,
      [normal[0]],
    );
    assert.equal((await one(db, "select history_sync.prune('1800-01-02',1) n")).n, 1);
    await auth(db, reader, true);
    const expired = (
      await one(db, 'select get_history_changes($1,$2,1) p', [chat, prePrune.sync_cursor])
    ).p;
    assert.deepEqual(expired, { status: 'expired', parentIds: [], cursor: null });
    const renewed = await one(db, 'select sync_cursor from get_history_range($1,$2,100)', [
      chat,
      saved.coverage,
    ]);
    assert.equal(
      (await one(db, 'select get_history_changes($1,$2,1) p', [chat, renewed.sync_cursor])).p
        .status,
      'current',
    );
    await db.query('rollback');
    await writer.query('rollback');
    const piece = await range(saved.coverage, reader, 3);
    assert.ok(piece.has_after);
    const rest = await range({
      lower: { ...piece.coverage.upper, inclusive: false },
      upper: saved.coverage.upper,
    });
    assert.deepEqual([...rowKeys(piece), ...rowKeys(rest)], rowKeys(await range(saved.coverage)));
    log('expired cursor + bounded range replacement PASS', true);
    // Same selected changes, 50k additional unrelated journal rows, rolled back.
    let sample = await range(saved.coverage);
    await sendEdit(normal[0], 'cost probe');
    await db.query('begin');
    const measure = async (name) => {
      await auth(db, reader, true);
      await timing(name, async () => {
        const r = (
          await one(db, 'select get_history_changes($1,$2,1) p', [chat, sample.sync_cursor])
        ).p;
        assert.deepEqual(r.parentIds, [normal[0]]);
      });
      await db.query('reset role');
    };
    await measure('small journal SQL round trip ms');
    noiseWriter = (await one(db, 'select pg_current_xact_id()::text id')).id;
    await db.query(
      'insert into history_sync.events(message_id) select gen_random_uuid() from generate_series(1,50000)',
    );
    await db.query('commit');
    sample = await range(saved.coverage);
    await sendEdit(normal[0], 'second cost probe');
    await db.query('begin');
    await db.query('analyze history_sync.events');
    await measure('journal +50000 SQL round trip ms');
    // Inspect the nested production statement, including its actual join order.
    await db.query(
      "load 'auto_explain'; set local auto_explain.log_analyze=on; set local auto_explain.log_buffers=on; set local auto_explain.log_nested_statements=on; set local auto_explain.log_format=json; set local auto_explain.log_level=notice; set local auto_explain.log_min_duration=0",
    );
    const scans = [];
    function collect(node) {
      if (
        node['Relation Name'] === 'events' ||
        ['events_pkey', 'history_events_writer_message'].includes(node['Index Name'])
      ) {
        scans.push({
          scan: node['Node Type'],
          index: node['Index Name'],
          rows: node['Actual Rows'],
          loops: node['Actual Loops'],
          hits: node['Shared Hit Blocks'],
        });
      }
      for (const child of node.Plans ?? []) collect(child);
    }
    db.on('notice', (notice) => {
      const start = notice.message.indexOf('\n{');
      if (start < 0 || !notice.message.includes('with deps as materialized')) return;
      collect(JSON.parse(notice.message.slice(start + 1)).Plan);
    });
    await auth(db, reader, true);
    await db.query('select get_history_changes($1,$2,1)', [chat, sample.sync_cursor]);
    log('actual journal lookup on +50000', scans);
    assert.ok(scans.some((s) => s.index && s.loops > 0));
    await db.query('rollback');
  } finally {
    await writer.query('rollback');
    await writer.end();
    await db.query('rollback');
    await db.query('reset role');
    await db.query('begin');
    const fixtureIds = (
      await db.query('select id from messages where chat_id=any($1)', [[chat, source, other]])
    ).rows.map((row) => row.id);
    if (noiseWriter)
      await db.query('delete from history_sync.events where writer=$1', [noiseWriter]);
    if (channelId) await db.query('delete from channels where id=$1', [channelId]);
    await db.query('delete from chats where id=any($1)', [[chat, source, other]]);
    await db.query('delete from auth.users where id=any($1)', [[author, reader]]);
    if (!config.syncBaseline)
      await db.query('delete from history_sync.events where message_id=any($1)', [fixtureIds]);
    await db.query('commit');
    await db.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
