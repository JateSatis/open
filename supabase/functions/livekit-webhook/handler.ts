/**
 * Вебхук LiveKit — источник правды о том, кто в звонке.
 *
 * Функция деплоится без проверки Supabase JWT: LiveKit его не пришлёт. Вместо
 * этого каждый запрос подписан LiveKit (JWT в `Authorization` с sha256 тела);
 * без подписи или с неверной подписью ничего не меняется — 401.
 *
 * Когда база говорит, что звонок кончился (вышел последний участник чата) или
 * что в комнату вошли по старому токену в уже завершённый эфир, функция
 * закрывает комнату в LiveKit — слушатели отключаются.
 */

import { json, parseRole, type StreamRole } from '../_shared/livekit.ts';

export type WebhookEventLike = {
  event: string;
  room?: { name: string } | null;
  participant?: { identity: string; sid: string; metadata?: string } | null;
  createdAt?: bigint | number | string;
};

export type WebhookDeps = {
  /** Проверяет подпись и разбирает тело; на неверной подписи бросает. */
  receive: (body: string, authorization: string | null) => Promise<WebhookEventLike>;
  joined: (input: { room: string; identity: string; sid: string; role: StreamRole | null; at: string }) => Promise<string>;
  left: (input: { room: string; identity: string; sid: string; at: string }) => Promise<string>;
  roomFinished: (room: string) => Promise<string>;
  closeRoom: (room: string) => Promise<void>;
  log?: (message: string, error?: unknown) => void;
};

function eventTime(createdAt: WebhookEventLike['createdAt']): string {
  const seconds = Number(createdAt ?? 0);

  return new Date(seconds > 0 ? seconds * 1000 : Date.now()).toISOString();
}

export function createWebhookHandler(deps: WebhookDeps) {
  const log = deps.log ?? (() => {});

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const body = await request.text();
    const authorization = request.headers.get('Authorization');

    if (!authorization) return json(401, { error: 'unauthorized' });

    let event: WebhookEventLike;

    try {
      event = await deps.receive(body, authorization);
    } catch (error) {
      log('webhook signature rejected', error);
      return json(401, { error: 'unauthorized' });
    }

    const room = event.room?.name;

    // Не наша комната — не наше дело; LiveKit не должен повторять.
    if (!room || !room.startsWith('stream-')) return json(200, { ignored: true });

    const at = eventTime(event.createdAt);
    const participant = event.participant;

    try {
      let outcome = 'ignored';

      switch (event.event) {
        case 'participant_joined':
          if (!participant) break;
          outcome = await deps.joined({
            room,
            identity: participant.identity,
            sid: participant.sid,
            role: parseRole(participant.metadata),
            at,
          });
          break;
        case 'participant_left':
        case 'participant_connection_aborted':
          if (!participant) break;
          outcome = await deps.left({ room, identity: participant.identity, sid: participant.sid, at });
          break;
        case 'room_finished':
          outcome = await deps.roomFinished(room);
          break;
      }

      // Комната пережила свой звонок (последний участник вышел или вход по
      // старому токену) — закрываем, слушатели отключаются. На room_finished
      // закрывать уже нечего.
      if (event.event !== 'room_finished' && (outcome === 'finished' || outcome === 'ended')) {
        await deps.closeRoom(room);
      }

      return json(200, { outcome });
    } catch (error) {
      // 500 — LiveKit повторит доставку, а функции базы к повтору готовы.
      log('webhook handling failed', error);
      return json(500, { error: 'server_error' });
    }
  };
}
