import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = resolve(ROOT, 'supabase', 'functions', '_shared', 'fixtures', 'plain.jpg');
const env = readEnvFile(resolve(ROOT, 'infra', '.env'));
const API_URL = required(env, 'SUPABASE_PUBLIC_URL').replace(/\/+$/, '');

function readEnvFile(path) {
  const values = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    values.set(match[1], match[2].replace(/^(['"])(.*)\1$/, '$2'));
  }
  return values;
}

function required(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`${name} не задан в infra/.env.`);
  return value;
}

async function request(
  path,
  { method = 'GET', key, token, body, contentType = 'application/json' } = {},
) {
  const headers = {};
  if (key) headers.apikey = key;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType) headers['Content-Type'] = contentType;
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fixtureWithExifMarker() {
  const source = readFileSync(FIXTURE);
  assert(source[0] === 0xff && source[1] === 0xd8, 'JPEG fixture is malformed.');
  const payload = Buffer.concat([
    Buffer.from('Exif\0\0', 'binary'),
    Buffer.from('OPEN-MIGRATION-TEST-METADATA'),
  ]);
  const segment = Buffer.alloc(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return Buffer.concat([source.subarray(0, 2), segment, source.subarray(2)]);
}

const anonKey = required(env, 'ANON_KEY');
const serviceKey = required(env, 'SERVICE_ROLE_KEY');
const email = `migration-check-${randomUUID()}@example.invalid`;
const fileName = `${randomUUID()}.jpg`;
let userId;
let accessToken;
let uploadedPath;
let sanitizedPath;
let createdUser = false;

try {
  const created = await request('/auth/v1/admin/users', {
    method: 'POST',
    key: serviceKey,
    token: serviceKey,
    body: JSON.stringify({ email, email_confirm: true }),
  });
  assert(created.response.ok && created.data?.id, 'Could not create temporary Auth test user.');
  userId = created.data.id;
  createdUser = true;

  const magicLink = await request('/auth/v1/admin/generate_link', {
    method: 'POST',
    key: serviceKey,
    token: serviceKey,
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const tokenHash = magicLink.data?.hashed_token;
  assert(
    magicLink.response.ok && tokenHash,
    `Could not issue a temporary Auth magic link (${magicLink.response.status}, fields=${Object.keys(magicLink.data ?? {}).join(',')}; properties=${Object.keys(magicLink.data?.properties ?? {}).join(',')}).`,
  );
  const verified = await request('/auth/v1/verify', {
    method: 'POST',
    key: anonKey,
    body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
  });
  assert(
    verified.response.ok && verified.data?.access_token,
    `Could not create a temporary user session (${verified.response.status}).`,
  );
  accessToken = verified.data.access_token;
  const validatedSession = await request('/auth/v1/user', { key: anonKey, token: accessToken });
  assert(validatedSession.response.ok, 'Auth rejected the temporary test session.');

  uploadedPath = `${userId}/${fileName}`;
  const upload = await request(`/storage/v1/object/uploads/${uploadedPath}`, {
    method: 'POST',
    key: anonKey,
    token: accessToken,
    body: fixtureWithExifMarker(),
    contentType: 'image/jpeg',
  });
  assert(upload.response.ok, `Temporary image upload failed (${upload.response.status}).`);

  const sanitized = await request('/functions/v1/sanitize-media', {
    method: 'POST',
    key: anonKey,
    token: accessToken,
    body: JSON.stringify({ path: uploadedPath, kind: 'group_avatar' }),
  });
  assert(
    sanitized.response.ok && sanitized.data?.path,
    `sanitize-media failed (${sanitized.response.status}).`,
  );
  sanitizedPath = sanitized.data.path;
  assert(
    sanitized.data.url === `${API_URL}/storage/v1/object/public/media/${sanitizedPath}`,
    'sanitize-media returned an unexpected public media URL.',
  );

  const publicImage = await fetch(sanitized.data.url);
  assert(publicImage.ok, `Public sanitized image is unavailable (${publicImage.status}).`);
  const cleanBytes = Buffer.from(await publicImage.arrayBuffer());
  assert(
    !cleanBytes.includes(Buffer.from('OPEN-MIGRATION-TEST-METADATA')),
    'Sanitized JPEG still contains the test metadata marker.',
  );

  const encodedPath = encodeURIComponent(sanitizedPath);
  const registered = await request(
    `/rest/v1/media_objects?select=bucket,path,owner_id,kind,mime_type,size_bytes&bucket=eq.media&path=eq.${encodedPath}`,
    { key: serviceKey, token: serviceKey },
  );
  assert(
    registered.response.ok && registered.data?.length === 1,
    'Sanitized media_objects row is missing.',
  );
  assert(
    registered.data[0].owner_id === userId && registered.data[0].kind === 'group_avatar',
    'media_objects row has unexpected owner or kind.',
  );
  console.log(
    'sanitize-media passed: temporary session → uploads → metadata stripped → public media URL → media_objects.',
  );
} finally {
  if (createdUser) {
    let removedByFunction = false;
    if (accessToken) {
      try {
        const deletion = await request('/functions/v1/delete-account', {
          method: 'POST',
          key: anonKey,
          token: accessToken,
          body: '{}',
        });
        removedByFunction = deletion.response.ok && deletion.data?.deleted === true;
      } catch {
        removedByFunction = false;
      }
    }

    if (!removedByFunction) {
      for (const [bucket, prefix] of [
        ['uploads', userId],
        ['media', userId],
      ]) {
        try {
          await request(`/storage/v1/object/${bucket}`, {
            method: 'DELETE',
            key: serviceKey,
            token: serviceKey,
            body: JSON.stringify({ prefixes: [prefix] }),
          });
        } catch {
          // The admin user deletion below remains the final cleanup attempt.
        }
      }
      try {
        await request(`/auth/v1/admin/users/${userId}`, {
          method: 'DELETE',
          key: serviceKey,
          token: serviceKey,
        });
      } catch {
        // Report a generic cleanup failure without printing account credentials.
      }
    }

    const remaining = await request(`/auth/v1/admin/users/${userId}`, {
      key: serviceKey,
      token: serviceKey,
    });
    if (remaining.response.ok) throw new Error('Temporary Auth test user remains after cleanup.');
    if (remaining.response.status !== 404)
      throw new Error('Could not verify temporary Auth user cleanup.');
    console.log('Temporary Auth user and its media artifacts were removed.');
  }
}
