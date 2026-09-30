/**
 * Сверка звонка с LiveKit по просьбе клиента — например, открывшего чат, где
 * по базе давно никто не говорит. Правда берётся только у LiveKit, поэтому
 * звать сверку может любой вошедший: подделать её результат запросом нельзя.
 *
 * Если в комнате не осталось говорящих, база завершает звонок, а функция
 * закрывает комнату — слушатели отключаются.
 */

import { isUuid, json, resolveCaller, type ConnectedParticipant } from '../_shared/livekit.ts';

export type SyncDeps = {
  resolveUserId: (accessToken: string) => Promise<string | null>;
  /** Комната живого звонка или null, если звонка нет или он завершён. */
  liveRoom: (streamId: string) => Promise<string | null>;
  listConnected: (room: string) => Promise<ConnectedParticipant[]>;
  reconcile: (room: string, connected: ConnectedParticipant[]) => Promise<string>;
  closeRoom: (room: string) => Promise<void>;
  log?: (message: string, error?: unknown) => void;
};

export function createSyncHandler(deps: SyncDeps) {
  const log = deps.log ?? (() => {});

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const userId = await resolveCaller(request, deps.resolveUserId, log);

    if (!userId) return json(401, { error: 'unauthorized' });

    let body: { stream_id?: unknown };

    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'bad_request' });
    }

    if (!isUuid(body?.stream_id)) return json(400, { error: 'bad_request' });

    try {
      const room = await deps.liveRoom(body.stream_id);

      if (!room) return json(200, { outcome: 'ended' });

      const outcome = await deps.reconcile(room, await deps.listConnected(room));

      if (outcome === 'finished') await deps.closeRoom(room);

      return json(200, { outcome });
    } catch (error) {
      log('sync failed', error);
      return json(502, { error: 'sync_failed' });
    }
  };
}
