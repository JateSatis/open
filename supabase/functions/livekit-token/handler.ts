/**
 * Токен входа в звонок. Кто входит — только из JWT вызывающего; с какой
 * ролью — решает база: участник чата говорит, все остальные слушают. Тело
 * запроса несёт лишь id звонка, никакая роль из запроса не принимается.
 *
 * Отказ: нет JWT или он битый (401), звонка нет (404), звонок завершён или
 * чат удалён (410). Секрет LiveKit не покидает функцию — наружу уходят только
 * токен, адрес LiveKit и роль.
 *
 * Зависимости передаются снаружи, чтобы границы проверялись Deno-тестом без
 * сети (`handler.test.ts`); настоящие — в `index.ts`.
 */

import { isUuid, json, resolveCaller, type StreamRole } from '../_shared/livekit.ts';

export type JoinInfo =
  | { found: false }
  | {
      found: true;
      stream_id: string;
      chat_id: string;
      room_name: string;
      status: 'live' | 'ended';
      chat_alive: boolean;
      profile_alive: boolean;
      role: StreamRole;
      display_name: string | null;
      speakers_count: number;
      started_at: string;
      speakers_changed_at: string;
    };

export type TokenDeps = {
  resolveUserId: (accessToken: string) => Promise<string | null>;
  joinInfo: (streamId: string, userId: string) => Promise<JoinInfo>;
  /** Сверить звонок с LiveKit: 'finished' — он оказался пустым и завершён. */
  reconcile: (room: string) => Promise<'ok' | 'finished' | 'ended'>;
  signToken: (input: { identity: string; name: string; room: string; role: StreamRole }) => Promise<string>;
  livekitUrl: string | null;
  now?: () => number;
  log?: (message: string, error?: unknown) => void;
};

/**
 * Говорящих по базе нет уже дольше этого — возможно, потерялся вебхук, и
 * звонок висит «живым». Перед выдачей токена он сверяется с LiveKit.
 */
export const STALE_AFTER_MS = 60_000;

export function createTokenHandler(deps: TokenDeps) {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? Date.now;

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const userId = await resolveCaller(request, deps.resolveUserId, log);

    if (!userId) return json(401, { error: 'unauthorized' });

    if (!deps.livekitUrl) {
      log('LIVEKIT_* secrets are not set');
      return json(503, { error: 'not_configured' });
    }

    let body: { stream_id?: unknown };

    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'bad_request' });
    }

    if (!isUuid(body?.stream_id)) return json(400, { error: 'bad_request' });

    let info: JoinInfo;

    try {
      info = await deps.joinInfo(body.stream_id, userId);
    } catch (error) {
      log('joinInfo failed', error);
      return json(500, { error: 'server_error' });
    }

    if (!info.found) return json(404, { error: 'not_found' });
    if (!info.profile_alive) return json(401, { error: 'unauthorized' });
    if (info.status !== 'live' || !info.chat_alive) return json(410, { error: 'ended' });

    const quietSince = Date.parse(info.speakers_changed_at);

    if (info.speakers_count === 0 && now() - quietSince > STALE_AFTER_MS) {
      try {
        if ((await deps.reconcile(info.room_name)) !== 'ok') return json(410, { error: 'ended' });
      } catch (error) {
        // LiveKit недоступен — звонок не хоронится по догадке; вход решит сам LiveKit.
        log('reconcile failed', error);
      }
    }

    let token: string;

    try {
      token = await deps.signToken({
        identity: userId,
        name: info.display_name ?? 'Без имени',
        room: info.room_name,
        role: info.role,
      });
    } catch (error) {
      log('signToken failed', error);
      return json(500, { error: 'server_error' });
    }

    return json(200, {
      token,
      url: deps.livekitUrl,
      role: info.role,
      stream_id: info.stream_id,
      chat_id: info.chat_id,
    });
  };
}
