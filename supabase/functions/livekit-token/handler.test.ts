// Запуск: npm run test:functions (Deno через npx, без установки).
//
// Токен подписывается настоящим SDK LiveKit и раскладывается обратно: права
// проверяются в самом токене, который получит клиент, а не в интерфейсе.

import { assertEquals, assertFalse } from 'jsr:@std/assert@1';

import { signParticipantToken, type StreamRole } from '../_shared/livekit.ts';
import { createTokenHandler, STALE_AFTER_MS, type JoinInfo, type TokenDeps } from './handler.ts';

const LIVEKIT = { url: 'wss://test.livekit.cloud', apiKey: 'APItest', apiSecret: 'secret-for-tests-only-0123456789abcdef' };

const STREAM = '11111111-1111-4111-8111-111111111111';
const MEMBER = '00000000-0000-4000-8000-00000000a11c';
const INVITED = '00000000-0000-4000-8000-00000000c0c0';
const VISITOR = '00000000-0000-4000-8000-000000000d0d';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const tokens: Record<string, string> = { member: MEMBER, invited: INVITED, visitor: VISITOR };

// Роль отдаёт база (`stream_join_info`, SQL-тест `calls_access.sql`): здесь
// — её ответы для участника, приглашённого-но-не-принявшего и постороннего.
const roles: Record<string, StreamRole> = { [MEMBER]: 'speaker', [INVITED]: 'listener', [VISITOR]: 'listener' };

function info(userId: string, overrides: Partial<Extract<JoinInfo, { found: true }>> = {}): JoinInfo {
  return {
    found: true,
    stream_id: STREAM,
    chat_id: '22222222-2222-4222-8222-222222222222',
    room_name: `stream-${STREAM}`,
    status: 'live',
    chat_alive: true,
    profile_alive: true,
    role: roles[userId],
    display_name: 'Имя',
    speakers_count: 1,
    started_at: new Date(NOW - 5_000).toISOString(),
    speakers_changed_at: new Date(NOW - 5_000).toISOString(),
    ...overrides,
  };
}

function setup(overrides: Partial<TokenDeps> = {}, joinOverrides: Partial<Extract<JoinInfo, { found: true }>> = {}) {
  const reconciled: string[] = [];

  const handler = createTokenHandler({
    resolveUserId: (token) => Promise.resolve(tokens[token] ?? null),
    joinInfo: (_stream, userId) => Promise.resolve(info(userId, joinOverrides)),
    reconcile: (room) => {
      reconciled.push(room);
      return Promise.resolve('ok');
    },
    signToken: (input) => signParticipantToken(LIVEKIT, input),
    livekitUrl: LIVEKIT.url,
    now: () => NOW,
    ...overrides,
  });

  return { handler, reconciled };
}

function request(init: { token?: string | null; body?: unknown; method?: string } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });

  if (init.token !== null) headers.set('Authorization', `Bearer ${init.token ?? 'member'}`);

  return new Request('http://localhost/livekit-token', {
    method: init.method ?? 'POST',
    headers,
    body: init.method === 'GET' ? undefined : JSON.stringify(init.body ?? { stream_id: STREAM }),
  });
}

type Claims = {
  sub: string;
  metadata: string;
  video: { room: string; roomJoin: boolean; canPublish?: boolean; canSubscribe?: boolean; canPublishData?: boolean; canPublishSources?: string[] };
};

function claimsOf(jwt: string): Claims {
  const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');

  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0))));
}

Deno.test('участник чата получает токен говорящего: публикует только микрофон', async () => {
  const { handler } = setup();

  const response = await handler(request({ token: 'member' }));
  const body = await response.json();
  const claims = claimsOf(body.token);

  assertEquals(response.status, 200);
  assertEquals(body.role, 'speaker');
  assertEquals(body.url, LIVEKIT.url);
  assertEquals(claims.sub, MEMBER);
  assertEquals(claims.video.room, `stream-${STREAM}`);
  assertEquals(claims.video.canPublish, true);
  assertEquals(claims.video.canPublishSources, ['microphone']);
  assertEquals(claims.video.canSubscribe, true);
  assertEquals(claims.video.canPublishData, false);
});

Deno.test('посетитель получает токен слушателя: без права публикации', async () => {
  const { handler } = setup();

  const response = await handler(request({ token: 'visitor' }));
  const body = await response.json();
  const claims = claimsOf(body.token);

  assertEquals(response.status, 200);
  assertEquals(body.role, 'listener');
  assertEquals(claims.sub, VISITOR);
  assertEquals(claims.video.canPublish, false);
  assertEquals(claims.video.canPublishSources, undefined);
  assertEquals(claims.video.canSubscribe, true);
  assertEquals(claims.video.canPublishData, false);
  assertEquals(JSON.parse(claims.metadata).role, 'listener');
});

Deno.test('приглашённый, но не принявший заявку — слушатель', async () => {
  const { handler } = setup();

  const body = await (await handler(request({ token: 'invited' }))).json();

  assertEquals(body.role, 'listener');
  assertFalse(claimsOf(body.token).video.canPublish);
});

Deno.test('роль из тела запроса игнорируется', async () => {
  const { handler } = setup();

  const body = await (
    await handler(request({ token: 'visitor', body: { stream_id: STREAM, role: 'speaker', canPublish: true } }))
  ).json();

  assertEquals(body.role, 'listener');
  assertFalse(claimsOf(body.token).video.canPublish);
});

Deno.test('без JWT — 401', async () => {
  const { handler } = setup();

  assertEquals((await handler(request({ token: null }))).status, 401);
});

Deno.test('битый JWT — 401', async () => {
  const { handler } = setup();

  assertEquals((await handler(request({ token: 'garbage.not.a.jwt' }))).status, 401);
});

Deno.test('Auth не смог проверить токен — 401, а не 500', async () => {
  const { handler } = setup({ resolveUserId: () => Promise.reject(new Error('auth down')) });

  assertEquals((await handler(request())).status, 401);
});

Deno.test('завершённый звонок — 410, токена нет', async () => {
  const { handler } = setup({}, { status: 'ended' });

  const response = await handler(request());
  const body = await response.json();

  assertEquals(response.status, 410);
  assertEquals(body.token, undefined);
});

Deno.test('чат удалён — 410', async () => {
  const { handler } = setup({}, { chat_alive: false });

  assertEquals((await handler(request())).status, 410);
});

Deno.test('звонка нет — 404', async () => {
  const { handler } = setup({ joinInfo: () => Promise.resolve({ found: false }) });

  assertEquals((await handler(request())).status, 404);
});

Deno.test('не uuid вместо id звонка — 400', async () => {
  const { handler } = setup();

  assertEquals((await handler(request({ body: { stream_id: "x'; drop table streams;--" } }))).status, 400);
});

Deno.test('только POST', async () => {
  const { handler } = setup();

  assertEquals((await handler(request({ method: 'GET' }))).status, 405);
});

Deno.test('секреты LiveKit не заданы — 503, а не токен без подписи', async () => {
  const { handler } = setup({ livekitUrl: null });

  assertEquals((await handler(request())).status, 503);
});

Deno.test('в ответе нет секрета LiveKit', async () => {
  const { handler } = setup();

  const text = await (await handler(request())).text();

  assertFalse(text.includes(LIVEKIT.apiSecret));
});

Deno.test('живой звонок с говорящими не сверяется — вход без задержки', async () => {
  const { handler, reconciled } = setup();

  await handler(request());

  assertEquals(reconciled, []);
});

Deno.test('давно пустой звонок сверяется с LiveKit и, оказавшись пустым, не пускает', async () => {
  const quiet = new Date(NOW - STALE_AFTER_MS - 1_000).toISOString();
  const { handler, reconciled } = setup(
    { reconcile: (room) => (reconciled.push(room), Promise.resolve('finished')) },
    { speakers_count: 0, speakers_changed_at: quiet },
  );

  const response = await handler(request());

  assertEquals(response.status, 410);
  assertEquals(reconciled, [`stream-${STREAM}`]);
});

Deno.test('недоступный LiveKit при сверке не хоронит звонок', async () => {
  const quiet = new Date(NOW - STALE_AFTER_MS - 1_000).toISOString();
  const { handler } = setup(
    { reconcile: () => Promise.reject(new Error('livekit down')) },
    { speakers_count: 0, speakers_changed_at: quiet },
  );

  assertEquals((await handler(request())).status, 200);
});
