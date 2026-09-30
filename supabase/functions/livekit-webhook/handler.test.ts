// Запуск: npm run test:functions (Deno через npx, без установки).
//
// Подпись проверяет настоящий WebhookReceiver LiveKit: валидный запрос
// подписывается тем же способом, что и в LiveKit Cloud (JWT с sha256 тела).

import { assertEquals } from 'jsr:@std/assert@1';
import { AccessToken, WebhookReceiver } from 'npm:livekit-server-sdk@2';

import { createWebhookHandler, type WebhookDeps } from './handler.ts';

const KEY = 'APItest';
const SECRET = 'secret-for-tests-only-0123456789abcdef';
const ROOM = 'stream-11111111-1111-4111-8111-111111111111';
const USER = '00000000-0000-4000-8000-00000000a11c';

type Call = { fn: string; args: unknown };

function setup(outcomes: Partial<Record<'joined' | 'left' | 'roomFinished', string>> = {}) {
  const calls: Call[] = [];
  const closed: string[] = [];
  const receiver = new WebhookReceiver(KEY, SECRET);

  const deps: WebhookDeps = {
    receive: (body, auth) => receiver.receive(body, auth ?? undefined),
    joined: (args) => (calls.push({ fn: 'joined', args }), Promise.resolve(outcomes.joined ?? 'ok')),
    left: (args) => (calls.push({ fn: 'left', args }), Promise.resolve(outcomes.left ?? 'ok')),
    roomFinished: (room) => (calls.push({ fn: 'roomFinished', args: room }), Promise.resolve(outcomes.roomFinished ?? 'finished')),
    closeRoom: (room) => (closed.push(room), Promise.resolve()),
  };

  return { handler: createWebhookHandler(deps), calls, closed };
}

function event(name: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'EV_1',
    event: name,
    createdAt: '1790000000',
    room: { name: ROOM, sid: 'RM_1' },
    participant: { sid: 'PA_1', identity: USER, metadata: '{"role":"speaker"}' },
    ...extra,
  });
}

async function sign(body: string, secret = SECRET): Promise<string> {
  const token = new AccessToken(KEY, secret);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));

  token.sha256 = btoa(String.fromCharCode(...new Uint8Array(digest)));

  return await token.toJwt();
}

function post(body: string, authorization?: string) {
  const headers = new Headers({ 'Content-Type': 'application/webhook+json' });

  if (authorization) headers.set('Authorization', authorization);

  return new Request('http://localhost/livekit-webhook', { method: 'POST', headers, body });
}

Deno.test('без подписи — 401 и в базе ничего не меняется', async () => {
  const { handler, calls, closed } = setup();

  const response = await handler(post(event('participant_left')));

  assertEquals(response.status, 401);
  assertEquals(calls, []);
  assertEquals(closed, []);
});

Deno.test('подпись чужим секретом — 401 и ничего не меняется', async () => {
  const { handler, calls } = setup();
  const body = event('participant_left');

  const response = await handler(post(body, await sign(body, 'someone-elses-secret-0123456789abcdef')));

  assertEquals(response.status, 401);
  assertEquals(calls, []);
});

Deno.test('подпись от другого тела — 401 и ничего не меняется', async () => {
  const { handler, calls } = setup();
  const signedFor = event('participant_joined');

  const response = await handler(post(event('room_finished'), await sign(signedFor)));

  assertEquals(response.status, 401);
  assertEquals(calls, []);
});

Deno.test('мусор в Authorization — 401', async () => {
  const { handler, calls } = setup();

  const response = await handler(post(event('room_finished'), 'Bearer nonsense'));

  assertEquals(response.status, 401);
  assertEquals(calls, []);
});

Deno.test('вход: роль из метаданных токена, время события LiveKit', async () => {
  const { handler, calls, closed } = setup();
  const body = event('participant_joined');

  const response = await handler(post(body, await sign(body)));

  assertEquals(response.status, 200);
  assertEquals(calls, [
    {
      fn: 'joined',
      args: { room: ROOM, identity: USER, sid: 'PA_1', role: 'speaker', at: new Date(1790000000 * 1000).toISOString() },
    },
  ]);
  assertEquals(closed, []);
});

Deno.test('вышел последний участник чата — комната закрывается, слушатели отключаются', async () => {
  const { handler, closed } = setup({ left: 'finished' });
  const body = event('participant_left');

  await handler(post(body, await sign(body)));

  assertEquals(closed, [ROOM]);
});

Deno.test('вышел не последний — комната живёт', async () => {
  const { handler, closed } = setup({ left: 'ok' });
  const body = event('participant_left');

  await handler(post(body, await sign(body)));

  assertEquals(closed, []);
});

Deno.test('вход в завершённый звонок по старому токену — комната закрывается', async () => {
  const { handler, closed } = setup({ joined: 'ended' });
  const body = event('participant_joined');

  await handler(post(body, await sign(body)));

  assertEquals(closed, [ROOM]);
});

Deno.test('room_finished завершает звонок в базе', async () => {
  const { handler, calls, closed } = setup();
  const body = event('room_finished', { participant: undefined });

  await handler(post(body, await sign(body)));

  assertEquals(calls, [{ fn: 'roomFinished', args: ROOM }]);
  assertEquals(closed, []);
});

Deno.test('чужая комната игнорируется', async () => {
  const { handler, calls } = setup();
  const body = event('participant_joined', { room: { name: 'lobby' } });

  const response = await handler(post(body, await sign(body)));

  assertEquals(response.status, 200);
  assertEquals(calls, []);
});

Deno.test('сбой базы — 500, LiveKit повторит доставку', async () => {
  const failing = createWebhookHandler({
    receive: (b, a) => new WebhookReceiver(KEY, SECRET).receive(b, a ?? undefined),
    joined: () => Promise.reject(new Error('db down')),
    left: () => Promise.resolve('ok'),
    roomFinished: () => Promise.resolve('ok'),
    closeRoom: () => Promise.resolve(),
  });
  const body = event('participant_joined');

  assertEquals((await failing(post(body, await sign(body)))).status, 500);
});
