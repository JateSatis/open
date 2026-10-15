// Запуск: npm run test:functions (Deno через npx, без установки).

import { assertEquals } from 'jsr:@std/assert@1';

import { createClustersHandler, type ClusterSnapshot, type ClustersDeps } from './handler.ts';

const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';

function snapshot(id: string, extra: Partial<ClusterSnapshot> = {}): ClusterSnapshot {
  return {
    message_id: id,
    lease: `lease-${id}`,
    msg_ids: [1],
    interactions: 3,
    text_version: '2026-10-16T10:00:00Z',
    text_hash: 'hash',
    text: 'какой-то другой уровень',
    model_version: 1,
    params: {},
    fragments: [{ id: 'f1', start: 9, end: 15, clusterId: null }],
    votes: [{ fragmentId: 'f1', userId: 'u1', kind: 'reaction', at: 1 }],
    previous: [],
    ...extra,
  };
}

function setup(batches: ClusterSnapshot[][], overrides: Partial<ClustersDeps> = {}) {
  const applied: { id: string; result: Record<string, unknown> }[] = [];
  const deduped: string[] = [];
  const requeued: string[] = [];
  const queue = [...batches];

  const handler = createClustersHandler({
    secret: 'worker-secret',
    claim: () => Promise.resolve(queue.shift() ?? []),
    apply: (id, result) => (applied.push({ id, result }), Promise.resolve('applied')),
    dedup: (id) => (deduped.push(id), Promise.resolve(0)),
    requeue: (id) => (requeued.push(id), Promise.resolve()),
    ...overrides,
  });

  return { handler, applied, deduped, requeued };
}

function request(token: string | null = 'worker-secret') {
  const headers = new Headers({ 'Content-Type': 'application/json' });

  if (token) headers.set('Authorization', `Bearer ${token}`);

  return new Request('http://localhost/fragment-clusters', { method: 'POST', headers, body: '{}' });
}

Deno.test('без секрета и с чужим секретом — 401, очередь не трогается', async () => {
  let claimed = false;
  const { handler } = setup([], { claim: () => ((claimed = true), Promise.resolve([])) });

  assertEquals((await handler(request(null))).status, 401);
  assertEquals((await handler(request('worker-secreT'))).status, 401);
  assertEquals((await handler(request('worker-secret-and-more'))).status, 401);
  assertEquals(claimed, false);
});

Deno.test('снимок считается моделью и пишется с арендой, заявками и версией текста', async () => {
  const { handler, applied, deduped } = setup([[snapshot(M1)]]);

  const body = await (await handler(request())).json();

  assertEquals(body.done.map((d: { outcome: string }) => d.outcome), ['applied']);
  assertEquals(applied.length, 1);

  const result = applied[0].result as Record<string, unknown> & { clusters: { display: unknown; fragmentIds: string[] }[] };

  assertEquals(result.lease, `lease-${M1}`);
  assertEquals(result.msg_ids, [1]);
  assertEquals(result.text_version, '2026-10-16T10:00:00Z');
  assertEquals(result.text_hash, 'hash');
  assertEquals(result.interactions, 3);
  assertEquals(result.clusters.length, 1);
  assertEquals(result.clusters[0].fragmentIds, ['f1']);
  assertEquals(result.clusters[0].display, { start: 9, end: 15 });
  assertEquals(deduped, [M1]);
});

Deno.test('удалённое сообщение — пустой результат без модели', async () => {
  let computed = false;
  const { handler, applied } = setup([[snapshot(M1, { deleted: true })]], {
    compute: () => ((computed = true), { clusters: [] }),
  });

  await handler(request());

  assertEquals(computed, false);
  assertEquals((applied[0].result as { clusters: unknown[] }).clusters, []);
});

Deno.test('аренда потеряна — схлопывать реакции нечего', async () => {
  const { handler, deduped } = setup([[snapshot(M1)]], { apply: () => Promise.resolve('lease_lost') });

  await handler(request());

  assertEquals(deduped, []);
});

Deno.test('сбой одного сообщения не останавливает пачку, заявка остаётся в очереди', async () => {
  const { handler, applied } = setup([[snapshot(M1), snapshot(M2)]], {
    apply: (id, result) =>
      id === M1 ? Promise.reject(new Error('timeout')) : (applied.push({ id, result }), Promise.resolve('applied')),
  });

  const body = await (await handler(request())).json();

  assertEquals(body.failed, [{ message_id: M1, error: 'timeout' }]);
  assertEquals(applied.map((a) => a.id), [M2]);
});

Deno.test('берёт пачки, пока очередь не опустеет', async () => {
  const { handler, applied } = setup([[snapshot(M1)], [snapshot(M2)]]);

  await handler(request());

  assertEquals(applied.map((a) => a.id), [M1, M2]);
});

Deno.test('бюджет времени кончился — новых пачек не берёт', async () => {
  let clock = 0;
  const { handler, applied } = setup([[snapshot(M1)], [snapshot(M2)]], {
    now: () => clock,
    budgetMs: 100,
    apply: (id, result) => ((clock += 150), applied.push({ id, result }), Promise.resolve('applied')),
  });

  await handler(request());

  assertEquals(applied.map((a) => a.id), [M1]);
});

Deno.test('схлопывание реакций не прошло — заявка ставится заново', async () => {
  const { handler, requeued } = setup([[snapshot(M1)]], {
    dedup: () => Promise.reject(new Error('lock timeout')),
  });

  const body = await (await handler(request())).json();

  assertEquals(requeued, [M1]);
  assertEquals(body.failed, []);
});
