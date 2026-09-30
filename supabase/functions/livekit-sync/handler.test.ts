// Запуск: npm run test:functions (Deno через npx, без установки).

import { assertEquals } from 'jsr:@std/assert@1';

import type { ConnectedParticipant } from '../_shared/livekit.ts';
import { createSyncHandler, type SyncDeps } from './handler.ts';

const STREAM = '11111111-1111-4111-8111-111111111111';
const ROOM = `stream-${STREAM}`;

function setup(overrides: Partial<SyncDeps> = {}, reconcileOutcome = 'ok') {
  const reconciled: ConnectedParticipant[][] = [];
  const closed: string[] = [];

  const handler = createSyncHandler({
    resolveUserId: (token) => Promise.resolve(token === 'valid' ? 'user' : null),
    liveRoom: () => Promise.resolve(ROOM),
    listConnected: () => Promise.resolve([{ identity: 'u', sid: 'PA', role: 'listener' }]),
    reconcile: (_room, connected) => (reconciled.push(connected), Promise.resolve(reconcileOutcome)),
    closeRoom: (room) => (closed.push(room), Promise.resolve()),
    ...overrides,
  });

  return { handler, reconciled, closed };
}

function request(token: string | null = 'valid', body: unknown = { stream_id: STREAM }) {
  const headers = new Headers({ 'Content-Type': 'application/json' });

  if (token) headers.set('Authorization', `Bearer ${token}`);

  return new Request('http://localhost/livekit-sync', { method: 'POST', headers, body: JSON.stringify(body) });
}

Deno.test('без JWT и с битым JWT — 401, сверки нет', async () => {
  const { handler, reconciled } = setup();

  assertEquals((await handler(request(null))).status, 401);
  assertEquals((await handler(request('broken'))).status, 401);
  assertEquals(reconciled, []);
});

Deno.test('состав берётся у LiveKit, а не из запроса', async () => {
  const { handler, reconciled } = setup();

  await handler(request('valid', { stream_id: STREAM, connected: [{ identity: 'fake', sid: 'x', role: 'host' }] }));

  assertEquals(reconciled, [[{ identity: 'u', sid: 'PA', role: 'listener' }]]);
});

Deno.test('говорящих не осталось — звонок завершён, комната закрыта', async () => {
  const { handler, closed } = setup({}, 'finished');

  const body = await (await handler(request())).json();

  assertEquals(body.outcome, 'finished');
  assertEquals(closed, [ROOM]);
});

Deno.test('звонок уже завершён — LiveKit не спрашивают', async () => {
  let asked = false;
  const { handler } = setup({
    liveRoom: () => Promise.resolve(null),
    listConnected: () => ((asked = true), Promise.resolve([])),
  });

  const body = await (await handler(request())).json();

  assertEquals(body.outcome, 'ended');
  assertEquals(asked, false);
});

Deno.test('LiveKit недоступен — 502, звонок не хоронится', async () => {
  const { handler, reconciled, closed } = setup({ listConnected: () => Promise.reject(new Error('down')) });

  assertEquals((await handler(request())).status, 502);
  assertEquals(reconciled, []);
  assertEquals(closed, []);
});
