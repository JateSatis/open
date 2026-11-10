/* Executed by test-history-elements.mjs inside the VPS Node runtime. */
/* global config */
const { Buffer } = require('node:buffer');
const { Client } = require('pg');
const { randomUUID, createHmac } = require('node:crypto');
const assert = require('node:assert/strict');

async function main() {
  const db = new Client({
    host: 'db',
    user: 'supabase_admin',
    database: 'postgres',
    password: config.password,
  });
  await db.connect();
  const uid = randomUUID(),
    viewer = randomUUID(),
    source = randomUUID(),
    chat = randomUUID(),
    single = randomUUID();
  const token = (user) => {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const b = Buffer.from(
      JSON.stringify({
        sub: user,
        role: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 7200,
      }),
    ).toString('base64url');
    return `${h}.${b}.${createHmac('sha256', config.secret).update(`${h}.${b}`).digest('base64url')}`;
  };
  const log = (x) => console.log(JSON.stringify(x));
  async function request(args, user = uid, legacy = config.baseline) {
    const select = legacy
      ? `*,items:history_window_messages(${config.legacyColumns})`
      : `*,items:history_window_elements(${config.elementColumns})`;
    const rpc = legacy ? 'get_history_window' : 'get_history_element_window';
    const url = `http://rest:3000/rpc/${rpc}?select=${encodeURIComponent(select)}&items.order=${legacy ? 'seq.asc' : 'seq.asc,position.asc'}`;
    const stats = async () =>
      +(
        await db.query(
          "select coalesce(sum(total_exec_time),0) ms from extensions.pg_stat_statements where query like $1 and query like 'WITH%pgrst%'",
          [`%${rpc}%`],
        )
      ).rows[0].ms;
    const before = await stats();
    const start = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token(user)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const text = await response.text();
    const httpMs = +(performance.now() - start).toFixed(1);
    return {
      status: response.status,
      bytes: Buffer.byteLength(text),
      httpMs,
      serverMs: response.ok ? +((await stats()) - before).toFixed(1) : null,
      data: JSON.parse(text),
    };
  }
  try {
    await db.query('begin');
    for (const user of [uid, viewer])
      await db.query(
        "insert into auth.users(id,email,raw_user_meta_data,aud,role) values($1,$2,'{}','authenticated','authenticated')",
        [user, `elements-${user}@test.local`],
      );
    await db.query(
      "update privacy_settings set public_message_visibility_delay='off',profile_identity_masking='everyone',dialogue_participant_name_masking='everyone',dialogue_media_visibility='everyone' where user_id=any($1)",
      [[uid, viewer]],
    );
    for (const id of [source, chat, single]) {
      await db.query(
        "insert into chats(id,kind,created_by,owner_id,title,founding_member_ids) values($1,'group',$2,$2,'History elements isolated fixture',array[$2]::uuid[])",
        [id, uid],
      );
      await db.query('insert into chat_members(chat_id,user_id) values($1,$2)', [id, uid]);
    }
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: uid, role: 'authenticated' }),
    ]);
    await db.query(
      "insert into messages(chat_id,author_id,kind,text) select $1,$2,'text',repeat('Original text ',80)||n from generate_series(1,1101)n",
      [source, uid],
    );
    await db.query(
      "insert into messages(chat_id,author_id,kind,text) select $1,$2,'text','normal '||n from generate_series(1,40)n",
      [chat, uid],
    );
    const originals = (
      await db.query('select id from messages where chat_id=$1 order by seq', [source])
    ).rows.map((x) => x.id);
    await db.query('set local role authenticated');
    const groups = [];
    for (let i = 0; i < 28; i++)
      groups.push(
        (
          await db.query('select forward_messages($1,$2,$3::uuid[]) id', [
            chat,
            source,
            originals.slice(0, 100),
          ])
        ).rows[0].id,
      );
    const singleGroup = (
      await db.query('select forward_messages($1,$2,$3::uuid[]) id', [
        single,
        source,
        originals.slice(0, 100),
      ])
    ).rows[0].id;
    await db.query('commit');
    log({
      fixture: 'created',
      path: 'HTTP local on VPS (open-storage → open-rest), SSH bound to physical interface',
      groups: 28,
    });
    if (process.env.ELEMENT_DIAG === '1') {
      await db.query(
        "load 'auto_explain'; set auto_explain.log_min_duration=1; set auto_explain.log_nested_statements=on; set auto_explain.log_analyze=on; set auto_explain.log_format=json; set auto_explain.log_level=notice",
      );
      db.on('notice', (notice) => console.log(notice.message));
      await db.query('begin');
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: uid, role: 'authenticated' }),
      ]);
      await db.query('set local role authenticated');
      await db.query("select * from get_history_element_window($1,'around',30,$2)", [
        source,
        originals[550],
      ]);
      await db.query('rollback');
      return;
    }
    if (!config.baseline) {
      const begin = performance.now();
      const response = await fetch(
        `http://rest:3000/history_element_rows?select=id,position&chat_id=eq.${single}&message_id=eq.${singleGroup}`,
        { headers: { Authorization: `Bearer ${token(uid)}` } },
      );
      assert.equal(response.status, 200);
      const raw = await response.text();
      const members = JSON.parse(raw);
      assert.equal(members.length, 100);
      assert.ok(members.every((row) => Object.keys(row).sort().join(',') === 'id,position'));
      log({
        test: 'lightweight group membership without original content',
        status: 'PASS',
        bytes: Buffer.byteLength(raw),
        httpMs: +(performance.now() - begin).toFixed(1),
      });
    }
    const middleItem = (
      await db.query('select id from forward_items where forward_id=$1 and position=50', [
        singleGroup,
      ])
    ).rows[0].id;
    const cases = [
      ['ordinary', { p_chat: source, p_mode: 'around', p_limit: 30, p_target: originals[550] }],
      [
        'group-100',
        {
          p_chat: single,
          p_mode: 'around',
          p_limit: 30,
          p_target: singleGroup,
          ...(!config.baseline ? { p_target_item: middleItem } : {}),
        },
      ],
      ['28-groups', { p_chat: chat, p_mode: 'latest', p_limit: 30 }],
    ];
    for (const [name, args] of cases)
      for (let repeat = 0; repeat < 3; repeat++) {
        const result = await request(args);
        const { data, ...measurement } = result;
        const rows = data[0]?.items ?? [];
        const expanded = rows.reduce(
          (n, x) => n + (config.baseline ? (x.items?.length ?? 0) : x.forward_item ? 1 : 0),
          0,
        );
        log({
          case: name,
          repeat,
          ...measurement,
          rows: rows.length,
          expanded,
          error: result.status === 200 ? undefined : data.message,
        });
        if (!config.baseline) {
          assert.equal(result.status, 200);
          assert.equal(rows.length, 30);
          assert(expanded <= 30);
        }
      }
    if (!config.baseline) {
      const get = async (args, user = uid) => {
        const r = await request(args, user);
        assert.equal(r.status, 200, JSON.stringify(r.data));
        return r.data[0];
      };
      const elements = (
        await db.query(
          'select i.id,i.position,m.seq from forward_items i join messages m on m.id=i.forward_id where i.forward_id=$1 order by i.position',
          [singleGroup],
        )
      ).rows;
      const pageArgs = { p_chat: single, p_limit: 30 };
      for (const user of [uid, viewer]) {
        let page = await get({ ...pageArgs, p_mode: 'latest' }, user);
        let walked = page.items.map((x) => x.id);
        while (page.before_cursor) {
          page = await get({ ...pageArgs, p_mode: 'before', p_cursor: page.before_cursor }, user);
          walked = page.items.map((x) => x.id).concat(walked);
        }
        assert.deepEqual(
          walked,
          elements.map((x) => x.id),
        );
        page = await get(
          {
            ...pageArgs,
            p_mode: 'after',
            p_cursor: { chatId: single, direction: 'after', seq: 0, position: 0 },
          },
          user,
        );
        walked = page.items.map((x) => x.id);
        while (page.after_cursor) {
          page = await get({ ...pageArgs, p_mode: 'after', p_cursor: page.after_cursor }, user);
          walked.push(...page.items.map((x) => x.id));
        }
        assert.deepEqual(
          walked,
          elements.map((x) => x.id),
        );
        for (const index of [0, 50, 99]) {
          const around = await get(
            {
              ...pageArgs,
              p_mode: 'around',
              p_target: singleGroup,
              p_target_item: elements[index].id,
            },
            user,
          );
          assert.equal(around.target_status, 'found');
          assert.equal(around.anchor.key, elements[index].id);
          assert.equal(around.items.length, 30);
          assert(around.items.some((x) => x.id === elements[index].id));
        }
      }
      log({
        test: '100-element group: both directions, around beginning/middle/end, member and visitor',
        status: 'PASS',
      });
      const expected = (
        await db.query(
          'select coalesce(i.id,m.id) id from messages m left join forward_items i on i.forward_id=m.id where m.chat_id=$1 order by m.seq,i.position',
          [chat],
        )
      ).rows.map((x) => x.id);
      let page = await get({ p_chat: chat, p_mode: 'latest', p_limit: 100 }),
        walked = page.items.map((x) => x.id);
      while (page.before_cursor) {
        page = await get({
          p_chat: chat,
          p_mode: 'before',
          p_limit: 100,
          p_cursor: page.before_cursor,
        });
        walked = page.items.map((x) => x.id).concat(walked);
      }
      assert.deepEqual(walked, expected);
      assert.equal(new Set(walked).size, 2840);
      log({
        test: 'mixed history with 28 repeated occurrences of each original: no gaps or duplicate keys',
        elements: walked.length,
        status: 'PASS',
      });
      const legacyLink = await get({
        ...pageArgs,
        p_mode: 'around',
        p_target: singleGroup,
        p_limit: 1,
      });
      assert.equal(legacyLink.anchor.key, elements[0].id);
      const boundary = await get({
        ...pageArgs,
        p_mode: 'around',
        p_target: singleGroup,
        p_target_item: elements[50].id,
        p_limit: 1,
      });
      await db.query('begin');
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: uid, role: 'authenticated' }),
      ]);
      await db.query('set local role authenticated');
      await db.query('select remove_forward_items($1,$2::uuid[])', [
        singleGroup,
        [originals[0], originals[50]],
      ]);
      await db.query('commit');
      const continued = await get({
        ...pageArgs,
        p_mode: 'after',
        p_cursor: boundary.after_cursor,
      });
      assert.equal(continued.items[0].id, elements[51].id);
      const deleted = await get({
        ...pageArgs,
        p_mode: 'around',
        p_target: singleGroup,
        p_target_item: elements[50].id,
      });
      assert.equal(deleted.target_status, 'unavailable');
      assert.equal(deleted.coverage, null);
      const substitute = await get({
        ...pageArgs,
        p_mode: 'around',
        p_target: singleGroup,
        p_target_item: elements[50].id,
        p_hint_seq: Number(elements[50].seq),
        p_hint_position: 50,
      });
      assert.equal(substitute.target_status, 'substituted');
      assert.equal(substitute.anchor.key, elements[51].id);
      assert.equal(
        (await get({ ...pageArgs, p_mode: 'around', p_target: singleGroup, p_limit: 1 })).anchor
          .key,
        elements[1].id,
      );
      await db.query('update messages set deleted_at=now() where id=$1', [originals[51]]);
      const removedOriginal = await get({
        ...pageArgs,
        p_mode: 'around',
        p_target: singleGroup,
        p_target_item: elements[51].id,
        p_limit: 1,
      });
      assert.equal(removedOriginal.items[0].id, elements[51].id);
      assert.equal(removedOriginal.items[0].forward_item.original, null);
      log({
        test: 'deleted boundary/target/original; stable placeholder; legacy link resolves surviving beginning',
        status: 'PASS',
      });
      for (const invalid of [
        { chatId: source, direction: 'before', seq: 1, position: 0 },
        { chatId: single, direction: 'after', seq: 1, position: 0 },
        { chatId: single, direction: 'before', seq: 1, position: 101 },
        { chatId: single, direction: 'before', seq: 1, position: 0.5 },
        { chatId: single, direction: 'before', seq: 1 },
      ])
        assert.equal(
          (await request({ ...pageArgs, p_mode: 'before', p_cursor: invalid })).status,
          400,
        );
      const empty = await get({
        ...pageArgs,
        p_mode: 'after',
        p_cursor: {
          chatId: single,
          direction: 'after',
          seq: Number(elements[99].seq),
          position: 99,
        },
      });
      assert.equal(empty.items.length, 0);
      assert.equal(empty.coverage.lower.inclusive, false);
      const reverse = await get({ ...pageArgs, p_mode: 'before', p_cursor: empty.before_cursor });
      assert.equal(reverse.items.at(-1).id, elements[99].id);
      const foreign = await get({
        ...pageArgs,
        p_mode: 'around',
        p_target: groups[0],
        p_target_item: elements[1].id,
      });
      assert.equal(foreign.target_status, 'unavailable');
      log({
        test: 'cursor validation, foreign target, empty-page reverse continuation and coverage',
        status: 'PASS',
      });
      await db.query(
        "update messages set text='PRIVATE_ELEMENT_TEXT public',hidden_ranges='{[0,20)}'::int4multirange where id=$1",
        [originals[10]],
      );
      const privateWindow = await get(
        {
          ...pageArgs,
          p_mode: 'around',
          p_target: singleGroup,
          p_target_item: elements[10].id,
          p_limit: 1,
        },
        viewer,
      );
      assert(!JSON.stringify(privateWindow).includes('PRIVATE_ELEMENT_TEXT'));
      await db.query(
        "update privacy_settings set profile_identity_masking='friends',dialogue_participant_name_masking='friends' where user_id=$1",
        [uid],
      );
      const opaque = await get(
        {
          ...pageArgs,
          p_mode: 'around',
          p_target: singleGroup,
          p_target_item: elements[10].id,
          p_limit: 1,
        },
        viewer,
      );
      assert(!JSON.stringify(opaque).includes(uid));
      log({ test: 'original viewer text and private identity remain protected', status: 'PASS' });
      await db.query("update messages set public_at=now()+interval '1 day' where id=$1", [
        originals[90],
      ]);
      const delayed = await get(
        {
          ...pageArgs,
          p_mode: 'around',
          p_target: singleGroup,
          p_target_item: elements[90].id,
          p_limit: 1,
        },
        viewer,
      );
      assert.equal(delayed.target_status, 'unavailable');
      assert.equal(
        (
          await get({
            ...pageArgs,
            p_mode: 'around',
            p_target: singleGroup,
            p_target_item: elements[90].id,
            p_limit: 1,
          })
        ).target_status,
        'found',
      );
      await db.query('update messages set public_at=created_at where chat_id=$1', [source]);
      const writer = new Client({
        host: 'db',
        user: 'supabase_admin',
        database: 'postgres',
        password: config.password,
      });
      await writer.connect();
      const lock = 78645231;
      try {
        await writer.query('select pg_advisory_lock($1)', [lock]);
        await db.query('begin');
        await db.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: uid, role: 'authenticated' }),
        ]);
        await db.query('set local role authenticated');
        const pid = (await db.query('select pg_backend_pid() pid')).rows[0].pid;
        const pending = db.query(
          `with w as materialized(select * from get_history_element_window($1,'around',1,$2,null,null,$3)),
          gate as materialized(select pg_advisory_xact_lock(${lock}) from w)
          select to_jsonb(w) envelope,(select jsonb_agg(jsonb_build_object('key',e.id,'text',o.text))
            from history_window_elements(w)e join forward_items f on f.id=e.forward_item_id
            left join message_rows o on o.id=f.message_id) content from w cross join gate`,
          [single, singleGroup, elements[10].id],
        );
        for (let i = 0; i < 100; i++) {
          const state = (
            await writer.query('select wait_event from pg_stat_activity where pid=$1', [pid])
          ).rows[0];
          if (state?.wait_event === 'advisory') break;
          if (i === 99) throw Error('Snapshot gate not reached');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await writer.query('begin');
        await writer.query('update forward_items set deleted_at=now() where id=$1', [
          elements[10].id,
        ]);
        await writer.query("update messages set text='concurrent original changed' where id=$1", [
          originals[10],
        ]);
        await writer.query('commit');
        await writer.query('select pg_advisory_unlock($1)', [lock]);
        const snapshot = (await pending).rows[0];
        await db.query('rollback');
        assert.equal(snapshot.envelope.anchor.key, elements[10].id);
        assert.equal(snapshot.content[0].key, elements[10].id);
        assert.equal(snapshot.content[0].text, 'PRIVATE_ELEMENT_TEXT public');
        assert.equal(
          (
            await get({
              ...pageArgs,
              p_mode: 'around',
              p_target: singleGroup,
              p_target_item: elements[10].id,
            })
          ).target_status,
          'unavailable',
        );
      } finally {
        await writer.query('rollback');
        await writer.query('select pg_advisory_unlock_all()');
        await writer.end();
      }
      log({
        test: 'unpublished original access; one snapshot for envelope/content during concurrent element deletion and original edit',
        status: 'PASS',
      });
      await db.query('begin');
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: uid, role: 'authenticated' }),
      ]);
      await db.query('set local role authenticated');
      await db.query('select block_user($1)', [viewer]);
      await db.query('commit');
      const blocked = await get({ ...pageArgs, p_mode: 'latest' }, viewer);
      assert.equal(blocked.items.length, 1);
      assert.equal(blocked.items[0].message.hidden, true);
      assert.equal(blocked.items[0].forward_item, null);
      const blockedTarget = await get(
        { ...pageArgs, p_mode: 'around', p_target: singleGroup },
        viewer,
      );
      assert.equal(blockedTarget.target_status, 'unavailable');
      log({
        test: 'blocked parent is one safe placeholder without group contents',
        status: 'PASS',
      });
    }
  } finally {
    await db.query('rollback');
    await db.query('begin');
    await db.query('delete from chats where id=any($1)', [[source, chat, single]]);
    await db.query('delete from auth.users where id=any($1)', [[uid, viewer]]);
    await db.query('commit');
    await db.end();
    log({ fixture: 'removed' });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
