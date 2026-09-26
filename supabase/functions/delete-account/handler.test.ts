// Запуск: npm run test:functions (Deno через npx, без установки).

import { assertEquals } from 'jsr:@std/assert@1';

import { createDeleteAccountHandler, type DeleteAccountDeps } from './handler.ts';

const VALID_TOKEN = 'token-of-alice';
const ALICE = '00000000-0000-4000-8000-00000000a11c';
const BOB = '00000000-0000-4000-8000-000000000b0b';

function setup(overrides: Partial<DeleteAccountDeps> = {}) {
  const deleted: string[] = [];
  const avatarsRemoved: string[] = [];

  const handler = createDeleteAccountHandler({
    resolveUserId: (token) => Promise.resolve(token === VALID_TOKEN ? ALICE : null),
    removeAvatarFiles: (userId) => {
      avatarsRemoved.push(userId);
      return Promise.resolve();
    },
    deleteUser: (userId) => {
      deleted.push(userId);
      return Promise.resolve();
    },
    ...overrides,
  });

  return { handler, deleted, avatarsRemoved };
}

function request(init: { token?: string | null; body?: unknown; method?: string } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });

  if (init.token !== null) headers.set('Authorization', `Bearer ${init.token ?? VALID_TOKEN}`);

  return new Request('http://localhost/delete-account', {
    method: init.method ?? 'POST',
    headers,
    body: init.method === 'GET' ? undefined : JSON.stringify(init.body ?? {}),
  });
}

Deno.test('без заголовка Authorization — 401 и никто не удалён', async () => {
  const { handler, deleted } = setup();

  const response = await handler(request({ token: null }));

  assertEquals(response.status, 401);
  assertEquals(deleted, []);
});

Deno.test('битый токен — 401 и никто не удалён', async () => {
  const { handler, deleted, avatarsRemoved } = setup();

  const response = await handler(request({ token: 'garbage.not.a.jwt' }));

  assertEquals(response.status, 401);
  assertEquals(deleted, []);
  assertEquals(avatarsRemoved, []);
});

Deno.test('Auth не смог проверить токен — 401, а не 500', async () => {
  const { handler, deleted } = setup({
    resolveUserId: () => Promise.reject(new Error('auth down')),
  });

  const response = await handler(request());

  assertEquals(response.status, 401);
  assertEquals(deleted, []);
});

Deno.test('валидный токен — удаляется ровно владелец токена', async () => {
  const { handler, deleted, avatarsRemoved } = setup();

  const response = await handler(request());

  assertEquals(response.status, 200);
  assertEquals(deleted, [ALICE]);
  assertEquals(avatarsRemoved, [ALICE]);
});

Deno.test('чужой id в теле запроса игнорируется', async () => {
  const { handler, deleted } = setup();

  const response = await handler(
    request({ body: { user_id: BOB, userId: BOB, id: BOB } }),
  );

  assertEquals(response.status, 200);
  assertEquals(deleted, [ALICE]);
});

Deno.test('только POST', async () => {
  const { handler, deleted } = setup();

  const response = await handler(request({ method: 'GET' }));

  assertEquals(response.status, 405);
  assertEquals(deleted, []);
});

Deno.test('сбой удаления аватара не мешает удалить аккаунт', async () => {
  const { handler, deleted } = setup({
    removeAvatarFiles: () => Promise.reject(new Error('storage down')),
  });

  const response = await handler(request());

  assertEquals(response.status, 200);
  assertEquals(deleted, [ALICE]);
});

Deno.test('сбой удаления пользователя — 500, клиент не считает аккаунт удалённым', async () => {
  const { handler } = setup({
    deleteUser: () => Promise.reject(new Error('db down')),
  });

  const response = await handler(request());

  assertEquals(response.status, 500);
});
