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
    single = randomUUID(),
    short = randomUUID(),
    deep = randomUUID(),
    mixed = randomUUID();
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
  const meta =
    'chat_id,target_status,anchor,before_cursor,after_cursor,has_before,has_after,coverage';
  const bounded = (paths) => paths.map((path) => '&' + path + '.limit=1').join('');
  async function request(args, user = uid, legacy = config.baseline, projection) {
    const select =
      projection ??
      (legacy
        ? `*,items:history_window_messages(${config.legacyColumns})`
        : (config.packedColumns ??
          `${meta},items:history_window_elements(${config.elementColumns})`));
    const rpc = legacy ? 'get_history_window' : 'get_history_element_window';
    const url =
      `http://rest:3000/rpc/${rpc}?select=${encodeURIComponent(select)}` +
      (select.includes('items:history_window')
        ? `&items.order=${legacy ? 'seq.asc' : 'seq.asc,position.asc'}`
        : '') +
      (select.includes('history_page_')
        ? bounded(
            config.uniqueEmbeds.filter((path) =>
              path === 'parents.forwarded'
                ? select.includes('forwarded:')
                : path === 'parents.source_chat'
                  ? select.includes('source_chat:')
                  : path === 'forwards.original'
                    ? select.includes('original:')
                    : select.includes('chat:chat_rows!messages_chat_id_fkey'),
            ),
          )
        : '');
    const stats = async () =>
      (
        await db.query(
          "select coalesce(sum(total_exec_time),0) ms, coalesce(sum(calls),0) calls, (select concat(dealloc,'/',stats_reset) from extensions.pg_stat_statements_info) epoch from extensions.pg_stat_statements where toplevel and query like $1 and query like 'WITH%pgrst%'",
          [`%${rpc}%`],
        )
      ).rows[0];
    const before = await stats();
    const start = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token(user)}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.pgrst.object+json',
      },
      body: JSON.stringify(args),
    });
    const text = await response.text();
    const httpMs = +(performance.now() - start).toFixed(1);
    const after = await stats();
    const calls = Number(after.calls) - Number(before.calls);
    const raw = JSON.parse(text);
    if (response.ok && select === config.packedColumns) {
      raw.items = raw.parents
        .flatMap((message) => {
          const children = raw.forwards.filter((f) => f.forward_id === message.id);
          return (children.length ? children : [null]).map((f) => ({
            id: f?.id ?? message.id,
            message,
            forward_item: f,
          }));
        })
        .sort(
          (a, b) =>
            a.message.seq - b.message.seq ||
            (a.forward_item?.position ?? 0) - (b.forward_item?.position ?? 0),
        );
      assert.deepEqual(
        raw.items.map((i) => i.id),
        raw.element_ids,
      );
    }
    return {
      status: response.status,
      bytes: Buffer.byteLength(text),
      httpMs,
      calls,
      serverMs:
        response.ok && calls === 1 && before.epoch === after.epoch
          ? +(after.ms - before.ms).toFixed(1)
          : null,
      data: response.ok ? [raw] : raw,
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
    for (const id of [source, chat, single, ...(config.profile ? [short, mixed, deep] : [])]) {
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
    if (config.profile) {
      await db.query(
        "insert into messages(chat_id,author_id,kind,text) select $1,$2,'text','short '||n from generate_series(1,120)n",
        [short, uid],
      );
      await db.query(
        "insert into messages(chat_id,author_id,kind,text) select $1,$2,case when n%4=0 then 'media' else 'text' end,case when n%4=0 then null when n%4=1 then repeat('Long text ',600) else 'short '||n end from generate_series(1,120)n",
        [mixed, uid],
      );
      await db.query(
        "insert into messages(chat_id,author_id,kind,text) select $1,$2,'text','short '||n from generate_series(1,2400)n",
        [deep, uid],
      );
      const path = uid + '/history-profile.jpg';
      await db.query(
        "insert into media_objects(bucket,path,owner_id,kind,mime_type,size_bytes) values('chat-media',$1,$2,'photo','image/jpeg',0)",
        [path, uid],
      );
      await db.query(
        "insert into attachments(message_id,message_kind,url,mime_type,width,height,position) select id,'media',$2,'image/jpeg',640,480,0 from messages where chat_id=$1 and kind='media'",
        [mixed, path],
      );
    }
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
    if (config.seek) {
      await db.query('begin');
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: uid, role: 'authenticated' }),
      ]);
      await db.query('set local role authenticated');
      for (const plan of ['force_generic_plan', 'force_custom_plan']) {
        await db.query('set local plan_cache_mode=' + plan);
        for (const [stage, sql] of [
          ['bounds', "select * from get_history_element_window($1,'latest',30)"],
          ['slice', "select * from history_element_slice($1,null,null,'before',30)"],
          [
            'parents',
            "with w as materialized(select * from get_history_element_window($1,'latest',30)) select count(*) from w cross join lateral history_page_parents(w)p",
          ],
          [
            'forwards',
            "with w as materialized(select * from get_history_element_window($1,'latest',30)) select count(*) from w cross join lateral history_page_forwards(w)f",
          ],
        ])
          for (let k = 0; k < 2; k++) {
            const x = await db.query('explain (analyze,format json,buffers) ' + sql, [source]);
            const v = x.rows[0]['QUERY PLAN'][0];
            log({ plan, stage, k, exec: v['Execution Time'], hits: v.Plan['Shared Hit Blocks'] });
          }
      }
      await db.query('rollback');
      return;
    }
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
    if (config.plan) {
      for (const [name, args] of cases) {
        const select = config.packedColumns;
        // Private benchmark instance only; never enable plan output on the public API.
        const target =
          'http://rest:3103/rpc/get_history_element_window?select=' +
          encodeURIComponent(select) +
          bounded(config.uniqueEmbeds);
        for (let rep = 0; rep < 3; rep++) {
          const r = await fetch(target, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + token(uid),
              'Content-Type': 'application/json',
              Accept: 'application/vnd.pgrst.object+json',
            },
            body: JSON.stringify(args),
          });
          assert.equal(r.status, 200);
          await r.arrayBuffer();
          log({ case: name, timing: r.headers.get('Server-Timing') });
        }
        const response = await fetch(
          'http://rest:3103/rpc/get_history_element_window?select=' +
            encodeURIComponent(select) +
            bounded(config.uniqueEmbeds),
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + token(uid),
              'Content-Type': 'application/json',
              Accept:
                'application/vnd.pgrst.plan+json; for="application/vnd.pgrst.object+json"; options=analyze|buffers',
            },
            body: JSON.stringify(args),
          },
        );
        const data = await response.json();
        assert.equal(response.status, 200, JSON.stringify(data).slice(0, 150));
        const nodes = [];
        function walk(n) {
          const ms = (n['Actual Total Time'] || 0) * (n['Actual Loops'] || 0);
          const child = n.Plans || [];
          const self =
            ms -
            child.reduce((v, c) => v + (c['Actual Total Time'] || 0) * (c['Actual Loops'] || 0), 0);
          if (self > 1)
            nodes.push({
              ms: Math.round(self),
              loops: n['Actual Loops'],
              rows: n['Actual Rows'],
              node: n['Node Type'],
              rel: n['Relation Name'] || n['Function Name'] || n.Alias,
            });
          child.forEach(walk);
        }
        walk(data[0].Plan);
        log({
          name,
          plan: data[0]['Planning Time'],
          exec: data[0]['Execution Time'],
          nodes: nodes.sort((a, b) => b.ms - a.ms).slice(0, 10),
        });
      }
      return;
    }
    if (config.profile) {
      const scenarios = [
        ['short', { p_chat: short, p_mode: 'latest' }],
        ['long-history', { p_chat: source, p_mode: 'latest' }],
        ['mixed', { p_chat: mixed, p_mode: 'latest' }],
        ...cases.slice(1),
      ];
      for (const [name, args] of scenarios) {
        for (let rep = 0; rep < 3; rep++) {
          const sizes = [20, 30, 60, 100];
          for (let k = 0; k < sizes.length; k++) {
            const size = sizes[(k + rep) % sizes.length];
            const { data, ...result } = await request({ ...args, p_limit: size });
            assert.equal(result.status, 200, JSON.stringify(data).slice(0, 200));
            log({ case: name, size, rep, ...result });
          }
        }
      }
      const dir = (id, seq, position) => ({
        p_chat: id,
        p_mode: 'before',
        p_limit: 30,
        p_cursor: { chatId: id, direction: 'before', seq, position },
      });
      const sample = async (name, args, projection) => {
        for (let rep = 0; rep < 3; rep++) {
          const { data, ...result } = await request(args, uid, false, projection);
          assert.equal(result.status, 200, JSON.stringify(data).slice(0, 200));
          log({ case: name, rep, ...result });
        }
      };
      for (const [id, n] of [
        [short, 120],
        [deep, 2400],
      ]) {
        const { seq } = (
          await db.query(
            'select seq from messages where chat_id=$1 order by seq limit 1 offset 60',
            [id],
          )
        ).rows[0];
        await sample('same-short-text/before-' + n, dir(id, Number(seq), 0));
      }
      await sample(
        'group-middle/before',
        dir(
          single,
          Number(
            (await db.query('select seq from messages where id=$1', [singleGroup])).rows[0].seq,
          ),
          50,
        ),
      );
      for (const [name, args] of cases) {
        for (const [stage, columns] of [
          ['bounds', meta],
          [
            'elements',
            config.packedColumns
              ? meta + ',element_ids'
              : meta + ',items:history_window_elements(id,seq,position)',
          ],
          [
            'visible',
            config.packedColumns
              ? meta +
                ',element_ids,parents:history_page_parents(id,text,author_id),forwards:history_page_forwards(id,original:message_rows!forward_items_message_fkey(id,text,author_id))'
              : meta +
                ',items:history_window_elements(id,message:history_element_message(id,text,author_id),forward_item:history_element_forward_item(id,original:message_rows!forward_items_message_fkey(id,text,author_id)))',
          ],
          [
            'parents',
            config.packedColumns
              ? meta + ',parents:history_page_parents(' + config.parentColumns + ')'
              : meta +
                ',items:history_window_elements(id,message:history_element_message(' +
                config.parentColumns +
                '))',
          ],
        ])
          await sample(name + '/' + stage, args, columns);
      }
      return;
    }
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
      if (config.packedColumns)
        for (const [, args] of cases)
          for (const user of [uid, viewer]) {
            const packed = (await request(args, user)).data[0];
            const previous = (
              await request(
                args,
                user,
                false,
                meta + ',items:history_window_elements(' + config.elementColumns + ')',
              )
            ).data[0];
            assert.deepEqual(
              packed.element_ids,
              previous.items.map((i) => i.id),
            );
            assert.equal(
              packed.parents.length,
              new Set(previous.items.map((i) => i.message_id)).size,
            );
            for (let n = 0; n < previous.items.length; n++) {
              const a = packed.items[n],
                b = previous.items[n];
              assert.deepEqual(a.message, b.message);
              if (a.forward_item) {
                const { forward_id, ...fields } = a.forward_item;
                assert.equal(forward_id, b.message_id);
                assert.deepEqual(fields, b.forward_item);
              } else assert.equal(b.forward_item, null);
            }
          }
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
          select to_jsonb(w) envelope,(select jsonb_agg(jsonb_build_object('key',f.id,'text',o.text,'parent',p.id))
            from history_page_forwards(w) f join history_page_parents(w) p on p.id=f.forward_id
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
        assert.equal(snapshot.content[0].parent, singleGroup);
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
      if (config.packedColumns) {
        // Deliberate cross-table UUID collision, including an item outside a partial group.
        const collision = elements[1].id;
        await db.query(
          "insert into messages(id,chat_id,author_id,kind,text) values($1,$2,$3,'text','history collision')",
          [collision, single, uid],
        );
        try {
          for (const limit of [1, 3, 100]) {
            const w = await get({ p_chat: single, p_mode: 'latest', p_limit: limit });
            assert.equal(w.items.at(-1).message.text, 'history collision');
            assert.equal(w.items.at(-1).forward_item, null);
            assert.equal(
              w.forwards.some((f) => f.id === collision),
              limit === 100,
            );
          }
        } finally {
          await db.query('delete from messages where id=$1 and chat_id=$2', [collision, single]);
        }
        log({
          test: 'cross-table UUID collision in and outside selected group range',
          status: 'PASS',
        });
      }
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
    await db.query('delete from chats where id=any($1)', [
      [source, chat, single, short, mixed, deep],
    ]);
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
