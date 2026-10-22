// Edge Function `sanitize-media`. Деплой: npx supabase functions deploy sanitize-media
//
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Edge Functions получают по
// умолчанию; сервисный ключ живёт только здесь и никогда не попадает в клиент.
//
// Чтение временного файла — запросами Range к Storage: план очистки видео
// строится по заголовкам коробок и `moov`, а сам mdat идёт потоком насквозь —
// в памяти функции не бывает больше `moov` и одного куска потока.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { createSanitizeHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function objectUrl(bucket: string, path: string): string {
  return `${url}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function objectRequest(bucket: string, path: string, range?: string): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
  };

  if (range) headers.Range = range;

  return fetch(objectUrl(bucket, path), { headers });
}

/** Первые `length` байт после `offset` из ответа без поддержки Range. */
async function sliceOf(response: Response, offset: number, length: number): Promise<Uint8Array> {
  const out = new Uint8Array(length);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  let position = 0;
  let filled = 0;

  try {
    while (filled < length) {
      const { done, value } = await reader.read();

      if (done) break;

      const from = Math.max(offset - position, 0);
      const to = Math.min(value.length, offset + length - position);

      if (from < to) {
        out.set(value.subarray(from, to), filled);
        filled += to - from;
      }

      position += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return out.subarray(0, filled);
}

const handler = createSanitizeHandler({
  resolveUserId: async (accessToken) => {
    // getUser идёт в Auth: подпись, срок и живость сеанса проверяет сервер.
    const { data, error } = await admin.auth.getUser(accessToken);

    if (error || !data.user) return null;

    return data.user.id;
  },
  size: async (bucket, path) => {
    const response = await objectRequest(bucket, path, 'bytes=0-0');

    if (response.status === 400 || response.status === 404) {
      await response.body?.cancel();
      return null;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`storage ${response.status}`);
    }

    const total = /\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '')?.[1];
    const length = total ?? response.headers.get('Content-Length');

    await response.body?.cancel();

    return length ? Number(length) : null;
  },
  read: async (bucket, path, offset, length) => {
    if (length === 0) return new Uint8Array(0);

    const response = await objectRequest(bucket, path, `bytes=${offset}-${offset + length - 1}`);

    if (response.status === 206) return new Uint8Array(await response.arrayBuffer());
    if (response.ok) return sliceOf(response, offset, length);

    await response.body?.cancel();
    throw new Error(`storage ${response.status}`);
  },
  readAll: async (bucket, path) => {
    const response = await objectRequest(bucket, path);

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`storage ${response.status}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  },
  stream: async (bucket, path) => {
    const response = await objectRequest(bucket, path);

    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`storage ${response.status}`);
    }

    return response.body;
  },
  write: async (bucket, path, body, _size, contentType) => {
    // Имена неизменяемы (новое имя — новый файл), поэтому кешировать можно долго.
    const { error } = await admin.storage.from(bucket).upload(path, body, {
      contentType,
      upsert: false,
      cacheControl: '31536000',
      duplex: 'half',
    });

    if (error) throw error;
  },
  register: async (row) => {
    const { error } = await admin.from('media_objects').insert(row);

    if (error) throw error;
  },
  remove: async (bucket, paths) => {
    await admin.storage.from(bucket).remove(paths);
  },
  publicUrl: (bucket, path) => admin.storage.from(bucket).getPublicUrl(path).data.publicUrl,
  newName: () => crypto.randomUUID(),
  log: (message, detail) => console.error(message, detail),
});

Deno.serve(handler);
