// Запуск: npm run test:functions (Deno через npx, без установки).

import { assertEquals } from 'jsr:@std/assert@1';

import { createMainRouter, FUNCTION_NAMES, resolveFunctionName, type RouteHandlers } from './index.ts';

function setupRoutes() {
  const called: string[] = [];
  const routes: RouteHandlers = {};

  for (const name of FUNCTION_NAMES) {
    routes[name] = async (request) => {
      called.push(`${request.method} ${name}`);
      return new Response(JSON.stringify({ fn: name }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  }

  return { router: createMainRouter(routes), called };
}

Deno.test('resolveFunctionName разбирает и прямой путь, и /functions/v1/<name>', () => {
  assertEquals(resolveFunctionName('/delete-account'), 'delete-account');
  assertEquals(resolveFunctionName('/functions/v1/livekit-token'), 'livekit-token');
  assertEquals(resolveFunctionName('/functions/v1/sanitize-media/'), 'sanitize-media');
  assertEquals(resolveFunctionName('/main/fragment-clusters'), 'fragment-clusters');
  assertEquals(resolveFunctionName('/'), null);
  assertEquals(resolveFunctionName('/functions/v1/'), null);
});

Deno.test('маршрутизирует все 6 функций по /<function-name> и /functions/v1/<function-name>', async () => {
  const { router, called } = setupRoutes();

  for (const name of FUNCTION_NAMES) {
    const direct = await router(new Request(`http://localhost/${name}`, { method: 'POST' }));
    assertEquals(direct.status, 200);
    assertEquals(await direct.json(), { fn: name });

    const prefixed = await router(new Request(`http://localhost/functions/v1/${name}`, { method: 'POST' }));
    assertEquals(prefixed.status, 200);
    assertEquals(await prefixed.json(), { fn: name });
  }

  assertEquals(called.length, FUNCTION_NAMES.length * 2);
});

Deno.test('неизвестный маршрут возвращает 404 not_found', async () => {
  const { router, called } = setupRoutes();

  const response = await router(new Request('http://localhost/unknown-fn', { method: 'POST' }));

  assertEquals(response.status, 404);
  assertEquals(await response.json(), { error: 'not_found' });
  assertEquals(called, []);
});

Deno.test('GET /health отдаёт список подключённых функций', async () => {
  const { router } = setupRoutes();

  const response = await router(new Request('http://localhost/health', { method: 'GET' }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.status, 'ok');
  assertEquals(body.functions, [...FUNCTION_NAMES]);
});
