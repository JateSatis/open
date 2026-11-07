// Единая точка входа (main worker) для self-hosted `supabase/edge-runtime`.
//
// В облегчённом стеке один процесс `edge-runtime` принимает запросы от Caddy
// (после срезания префикса `/functions/v1`) по путям `/<function-name>` и
// распределяет их между существующими 6 обработчиками без изменения их
// `handler.ts` и тестов.
//
// Внутреннее общение с Auth, PostgREST и Storage идёт по Docker-сети
// (`SUPABASE_INTERNAL_URL`, по умолчанию `SUPABASE_URL`), а публичные адреса
// бакета `media` строятся от внешнего `SUPABASE_PUBLIC_URL` (`SUPABASE_URL`),
// чтобы в базу попадали ссылки с публичным доменом сервера.

import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  closeRoom,
  json,
  listConnected,
  readLiveKitConfig,
  signParticipantToken,
  webhookReceiver,
} from '../_shared/livekit.ts';
import { createDeleteAccountHandler, createRemoveAvatarFiles } from '../delete-account/handler.ts';
import { createClustersHandler, type ClusterSnapshot } from '../fragment-clusters/handler.ts';
import { createSyncHandler } from '../livekit-sync/handler.ts';
import { createTokenHandler, type JoinInfo } from '../livekit-token/handler.ts';
import { createWebhookHandler } from '../livekit-webhook/handler.ts';
import { createSanitizeHandler } from '../sanitize-media/handler.ts';

export type RouteHandlers = Record<string, (request: Request) => Promise<Response>>;

/** Извлекает имя функции из пути запроса (`/functions/v1/<name>` или `/<name>`). */
export function resolveFunctionName(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] === 'functions' && segments[1] === 'v1') {
    return segments[2] ?? null;
  }

  if (segments[0] === 'main' && segments.length > 1) {
    return segments[1] ?? null;
  }

  return segments[0] ?? null;
}

/** Чистый маршрутизатор по таблице обработчиков. */
export function createMainRouter(routes: RouteHandlers) {
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);

    if (request.method === 'GET' && (pathname === '/' || pathname === '/health' || pathname === '/_internal/health')) {
      return json(200, { status: 'ok', functions: Object.keys(routes) });
    }

    const name = resolveFunctionName(pathname);
    const handler = name ? routes[name] : undefined;

    if (!handler) {
      return json(404, { error: 'not_found' });
    }

    return await handler(request);
  };
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

function buildDefaultRoutes(): RouteHandlers {
  const internalUrl = (Deno.env.get('SUPABASE_INTERNAL_URL') ?? Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const publicBaseUrl = (Deno.env.get('SUPABASE_PUBLIC_URL') ?? Deno.env.get('SUPABASE_URL') ?? internalUrl).replace(
    /\/+$/,
    '',
  );
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const admin = createClient(internalUrl || 'http://localhost:8000', serviceKey || 'unconfigured', {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const resolveUserId = async (accessToken: string): Promise<string | null> => {
    const { data, error } = await admin.auth.getUser(accessToken);

    if (error || !data.user) return null;

    return data.user.id;
  };

  const livekit = readLiveKitConfig();
  const publicLivekitUrl = Deno.env.get('LIVEKIT_PUBLIC_URL') ?? livekit?.url ?? null;

  const callRpc = async (fn: string, args: Record<string, unknown>): Promise<string> => {
    const { data, error } = await admin.rpc(fn, args);

    if (error) throw error;

    return String(data);
  };

  const objectUrl = (bucket: string, path: string): string =>
    `${internalUrl}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;

  const objectRequest = (bucket: string, path: string, range?: string): Promise<Response> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    };

    if (range) headers.Range = range;

    return fetch(objectUrl(bucket, path), { headers });
  };

  return {
    'delete-account': createDeleteAccountHandler({
      resolveUserId,
      removeAvatarFiles: async (userId) => {
        await createRemoveAvatarFiles(admin.storage.from('avatars'), (id) => id)(userId);
        await createRemoveAvatarFiles(admin.storage.from('media'))(userId);
      },
      deleteUser: async (userId) => {
        const { error } = await admin.auth.admin.deleteUser(userId);

        if (error) throw error;
      },
      log: (message, error) => console.error(message, error),
    }),

    'fragment-clusters': createClustersHandler({
      secret: Deno.env.get('FRAGMENT_CLUSTERS_SECRET') ?? '',
      claim: async (batch) => {
        const { data, error } = await admin.rpc('fragment_clusters_claim', { batch });

        if (error) throw error;

        return (data ?? []) as ClusterSnapshot[];
      },
      apply: async (messageId, result) => {
        const { data, error } = await admin.rpc('fragment_clusters_apply', {
          target_message: messageId,
          result,
        });

        if (error) throw error;

        return String(data);
      },
      dedup: async (messageId) => {
        const { data, error } = await admin.rpc('fragment_clusters_dedup', { target_message: messageId });

        if (error) throw error;

        return Number(data ?? 0);
      },
      requeue: async (messageId) => {
        const { error } = await admin.rpc('fragment_clusters_enqueue', { target_message: messageId });

        if (error) throw error;
      },
      log: (message, error) => console.error(message, error),
    }),

    'livekit-sync': createSyncHandler({
      resolveUserId,
      liveRoom: async (streamId) => {
        const { data, error } = await admin
          .from('streams')
          .select('room_name')
          .eq('id', streamId)
          .eq('status', 'live')
          .maybeSingle();

        if (error) throw error;

        return data?.room_name ?? null;
      },
      listConnected: (room) => {
        if (!livekit) throw new Error('LIVEKIT_* secrets are not set');

        return listConnected(livekit, room);
      },
      reconcile: (room, connected) => callRpc('reconcile_stream', { room, connected }),
      closeRoom: (room) => closeRoom(livekit!, room),
      log: (message, error) => console.error(message, error),
    }),

    'livekit-token': createTokenHandler({
      resolveUserId,
      joinInfo: async (streamId, userId) => {
        const { data, error } = await admin.rpc('stream_join_info', {
          target_stream: streamId,
          caller: userId,
        });

        if (error) throw error;

        return data as JoinInfo;
      },
      reconcile: async (room) => {
        if (!livekit) return 'ok';

        const connected = await listConnected(livekit, room);
        const { data, error } = await admin.rpc('reconcile_stream', { room, connected });

        if (error) throw error;
        if (data === 'finished') await closeRoom(livekit, room);

        return data as 'ok' | 'finished' | 'ended';
      },
      signToken: (input) => signParticipantToken(livekit!, input),
      livekitUrl: publicLivekitUrl,
      log: (message, error) => console.error(message, error),
    }),

    'livekit-webhook': createWebhookHandler({
      receive: async (body, authorization) => {
        if (!livekit) throw new Error('LIVEKIT_* secrets are not set');

        return await webhookReceiver(livekit).receive(body, authorization ?? undefined);
      },
      joined: ({ room, identity, sid, role, at }) =>
        callRpc('stream_participant_joined', { room, identity, sid, participant_role: role, event_at: at }),
      left: ({ room, identity, sid, at }) =>
        callRpc('stream_participant_left', { room, identity, sid, event_at: at }),
      roomFinished: (room) => callRpc('stream_room_finished', { room }),
      closeRoom: (room) => closeRoom(livekit!, room),
      log: (message, error) => console.error(message, error),
    }),

    'sanitize-media': createSanitizeHandler({
      resolveUserId,
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
      move: async (bucket, from, to) => {
        const { error } = await admin.storage.from(bucket).move(from, to);

        if (error) throw error;
      },
      listStale: async (bucket, folder, olderThanMs) => {
        const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100 });

        if (error) throw error;

        const before = Date.now() - olderThanMs;

        return (data ?? [])
          .filter((file) => file.id && file.created_at && Date.parse(file.created_at) < before)
          .map((file) => `${folder}/${file.name}`);
      },
      publicUrl: (bucket, path) =>
        `${publicBaseUrl}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,
      newName: () => crypto.randomUUID(),
      log: (message, detail) => console.error(message, detail),
    }),
  };
}

export const FUNCTION_NAMES = [
  'delete-account',
  'fragment-clusters',
  'livekit-sync',
  'livekit-token',
  'livekit-webhook',
  'sanitize-media',
] as const;

if (import.meta.main) {
  Deno.serve(createMainRouter(buildDefaultRoutes()));
}
