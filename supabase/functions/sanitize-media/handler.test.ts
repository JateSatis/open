// Запуск: npm run test:functions (Deno через npx, без установки).

import { assert, assertEquals } from 'jsr:@std/assert@1';

import { createSanitizeHandler, type SanitizeDeps } from './handler.ts';

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const BOB = '00000000-0000-4000-8000-000000000b0b';
const fixture = (name: string) =>
  Deno.readFile(new URL(`../_shared/fixtures/${name}`, import.meta.url));

type Stored = { bytes: Uint8Array; contentType?: string };

function setup(overrides: Partial<SanitizeDeps> = {}) {
  const buckets = new Map<string, Map<string, Stored>>();
  const registered: Record<string, unknown>[] = [];
  const logged: unknown[] = [];
  const bucket = (name: string) => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    return buckets.get(name) as Map<string, Stored>;
  };

  const deps: SanitizeDeps = {
    resolveUserId: async (token) => (token === 'alice' ? ALICE : null),
    size: async (b, p) => bucket(b).get(p)?.bytes.length ?? null,
    read: async (b, p, offset, length) =>
      (bucket(b).get(p) as Stored).bytes.slice(offset, offset + length),
    readAll: async (b, p) => (bucket(b).get(p) as Stored).bytes.slice(),
    stream: async (b, p) => {
      const bytes = (bucket(b).get(p) as Stored).bytes;

      return new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < bytes.length; at += 1000) controller.enqueue(bytes.slice(at, at + 1000));
          controller.close();
        },
      });
    },
    write: async (b, p, body, _size, contentType) => {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());

      bucket(b).set(p, { bytes, contentType });
    },
    register: async (row) => {
      registered.push(row);
    },
    remove: async (b, paths) => {
      paths.forEach((p) => bucket(b).delete(p));
    },
    move: async (b, from, to) => {
      const stored = bucket(b).get(from) as Stored;

      bucket(b).delete(from);
      bucket(b).set(to, stored);
    },
    listStale: async () => [],
    publicUrl: (b, p) => `https://example.supabase.co/storage/v1/object/public/${b}/${p}`,
    newName: () => 'fixed-name',
    log: (_message, detail) => logged.push(detail),
    ...overrides,
  };

  const handler = createSanitizeHandler(deps);
  const call = (body: unknown, token: string | null = 'alice') =>
    handler(
      new Request('http://localhost/sanitize-media', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(body),
      }),
    );

  return { bucket, registered, logged, call };
}

Deno.test('a staged video is cleaned, stored for chats and registered to its owner', async () => {
  const { bucket, registered, call } = setup();

  bucket('uploads').set(`${ALICE}/abc.mp4`, { bytes: await fixture('geo-faststart.mp4') });

  const response = await call({ path: `${ALICE}/abc.mp4`, kind: 'video' });
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.path, `${ALICE}/video/fixed-name.mp4`);
  assertEquals(body.url, body.path, 'chat media has no public address');

  const stored = bucket('chat-media').get(body.path) as Stored;
  const asText = new TextDecoder('latin1').decode(stored.bytes);

  assert(!asText.includes('55.7558'));
  assertEquals(stored.contentType, 'video/mp4');
  assertEquals(registered, [
    {
      bucket: 'chat-media',
      path: body.path,
      owner_id: ALICE,
      kind: 'video',
      mime_type: 'video/mp4',
      size_bytes: stored.bytes.length,
    },
  ]);
  assertEquals(bucket('uploads').size, 0, 'staged file is removed');
});

Deno.test('pop media and group photos go to the public bucket with a public address', async () => {
  const { bucket, call } = setup();

  bucket('uploads').set(`${ALICE}/p.jpg`, { bytes: await fixture('plain.jpg') });

  const body = await (await call({ path: `${ALICE}/p.jpg`, kind: 'group_avatar' })).json();

  assertEquals(body.path, `${ALICE}/group-avatar/fixed-name.jpg`);
  assertEquals(body.url, `https://example.supabase.co/storage/v1/object/public/media/${body.path}`);
});

Deno.test('the profile photo goes to the closed avatars bucket', async () => {
  const { bucket, call } = setup();

  bucket('uploads').set(`${ALICE}/a.jpg`, { bytes: await fixture('plain.jpg') });

  const body = await (await call({ path: `${ALICE}/a.jpg`, kind: 'avatar' })).json();

  assertEquals(body.url, `${ALICE}/fixed-name.jpg`);
  assert(bucket('avatars').has(`${ALICE}/fixed-name.jpg`));
});

Deno.test('a file that cannot be cleaned is refused, not published, and removed', async () => {
  const { bucket, registered, call } = setup();

  bucket('uploads').set(`${ALICE}/x.jpg`, { bytes: new TextEncoder().encode('not an image at all') });

  const response = await call({ path: `${ALICE}/x.jpg`, kind: 'photo' });

  assertEquals(response.status, 422);
  assertEquals((await response.json()).error, 'unsupported_media');
  assertEquals(bucket('chat-media').size, 0);
  assertEquals(registered.length, 0);
  assertEquals(bucket('uploads').size, 0);
});

Deno.test("someone else's staged file is neither cleaned nor removed", async () => {
  const { bucket, call } = setup();

  bucket('uploads').set(`${BOB}/b.jpg`, { bytes: await fixture('plain.jpg') });

  const response = await call({ path: `${BOB}/b.jpg`, kind: 'photo' });

  assertEquals(response.status, 400);
  assert(bucket('uploads').has(`${BOB}/b.jpg`));
});

Deno.test('no token, unknown kind or a path outside the folder is refused', async () => {
  const { call } = setup();

  assertEquals((await call({ path: `${ALICE}/a.jpg`, kind: 'photo' }, null)).status, 401);
  assertEquals((await call({ path: `${ALICE}/a.jpg`, kind: 'document' })).status, 400);
  assertEquals((await call({ path: `${ALICE}/../${BOB}/a.jpg`, kind: 'photo' })).status, 400);
  assertEquals((await call({ path: `${ALICE}/missing.jpg`, kind: 'photo' })).status, 404);
});

Deno.test('a failed registration removes the stored copy', async () => {
  const { bucket, call } = setup({
    register: async () => {
      throw new Error('db down');
    },
  });

  bucket('uploads').set(`${ALICE}/a.jpg`, { bytes: await fixture('plain.jpg') });

  const response = await call({ path: `${ALICE}/a.jpg`, kind: 'photo' });

  assertEquals(response.status, 500);
  assertEquals(bucket('chat-media').size, 0);
});

Deno.test('the log gets only the error name', async () => {
  const { bucket, logged, call } = setup({
    write: async () => {
      throw new Error('GPS 55.7558 in some message');
    },
  });

  bucket('uploads').set(`${ALICE}/a.jpg`, { bytes: await fixture('plain.jpg') });
  await call({ path: `${ALICE}/a.jpg`, kind: 'photo' });

  assertEquals(logged, ['Error']);
});

Deno.test('the staged file is moved out of the client folder before it is read', async () => {
  const reads: string[] = [];
  const { bucket, call } = setup({
    readAll: async (b, p) => {
      reads.push(p);
      return (bucket(b).get(p) as Stored).bytes.slice();
    },
  });

  bucket('uploads').set(`${ALICE}/a.jpg`, { bytes: await fixture('plain.jpg') });
  await call({ path: `${ALICE}/a.jpg`, kind: 'photo' });

  // Клиент пишет только в свою папку — подменить рабочую копию ему негде.
  assertEquals(reads.length, 1);
  assert(reads[0].startsWith('_work/'));
  assertEquals(bucket('uploads').size, 0);
});

Deno.test('abandoned staged uploads of the caller are swept', async () => {
  const removed: string[][] = [];
  const { bucket, call } = setup({
    listStale: async (_b, folder) => [`${folder}/old.jpg`],
    remove: async (b, paths) => {
      removed.push(paths);
      paths.forEach((p) => bucket(b).delete(p));
    },
  });

  bucket('uploads').set(`${ALICE}/a.jpg`, { bytes: await fixture('plain.jpg') });
  await call({ path: `${ALICE}/a.jpg`, kind: 'photo' });

  assert(removed.some((paths) => paths.includes(`${ALICE}/old.jpg`)));
});
