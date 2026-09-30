/**
 * Общее для функций звонков: роли, права в токене LiveKit и мелочи HTTP.
 *
 * Права решаются здесь, на сервере, и нигде больше: слушатель не может
 * говорить не потому, что у него нет кнопки, а потому, что в его токене нет
 * `canPublish`. Секрет LiveKit живёт только в секретах Edge Functions.
 */

import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from 'npm:livekit-server-sdk@2';

export type StreamRole = 'host' | 'speaker' | 'listener';

export type LiveKitConfig = { url: string; apiKey: string; apiSecret: string };

/** Кто в комнате прямо сейчас, по данным LiveKit. */
export type ConnectedParticipant = { identity: string; sid: string; role: StreamRole | null };

/** Сколько живёт токен входа. Подключённым LiveKit сам продлевает его. */
export const TOKEN_TTL = '10m';

export function canSpeak(role: StreamRole): boolean {
  return role !== 'listener';
}

/**
 * Права в комнате. Говорящий публикует только микрофон — видео добавится
 * источником `camera` сюда же, без смены схемы ролей. Данные в комнату не
 * пишет никто: всё, что надо разослать, идёт через базу.
 */
export function grantsFor(role: StreamRole, room: string) {
  return canSpeak(role)
    ? {
        roomJoin: true,
        room,
        canSubscribe: true,
        canPublish: true,
        canPublishSources: [TrackSource.MICROPHONE],
        canPublishData: false,
        canUpdateOwnMetadata: false,
      }
    : {
        roomJoin: true,
        room,
        canSubscribe: true,
        canPublish: false,
        canPublishData: false,
        canUpdateOwnMetadata: false,
      };
}

export async function signParticipantToken(
  config: LiveKitConfig,
  input: { identity: string; name: string; room: string; role: StreamRole },
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: input.identity,
    name: input.name,
    ttl: TOKEN_TTL,
    metadata: JSON.stringify({ role: input.role }),
  });

  token.addGrant(grantsFor(input.role, input.room));

  return await token.toJwt();
}

export function parseRole(metadata: string | undefined | null): StreamRole | null {
  if (!metadata) return null;

  try {
    const role = (JSON.parse(metadata) as { role?: unknown }).role;

    return role === 'host' || role === 'speaker' || role === 'listener' ? role : null;
  } catch {
    return null;
  }
}

/** API комнат LiveKit ходит по https, клиент — по wss того же адреса. */
export function httpUrl(url: string): string {
  return url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
}

export function readLiveKitConfig(): LiveKitConfig | null {
  const url = Deno.env.get('LIVEKIT_URL') ?? '';
  const apiKey = Deno.env.get('LIVEKIT_API_KEY') ?? '';
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET') ?? '';

  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
}

export function roomService(config: LiveKitConfig): RoomServiceClient {
  return new RoomServiceClient(httpUrl(config.url), config.apiKey, config.apiSecret);
}

export function webhookReceiver(config: LiveKitConfig): WebhookReceiver {
  return new WebhookReceiver(config.apiKey, config.apiSecret);
}

export async function listConnected(
  config: LiveKitConfig,
  room: string,
): Promise<ConnectedParticipant[]> {
  try {
    const participants = await roomService(config).listParticipants(room);

    return participants.map((p) => ({ identity: p.identity, sid: p.sid, role: parseRole(p.metadata) }));
  } catch (error) {
    // Комнаты нет — значит, в ней никого. Прочие сбои пробрасываются: решать
    // «звонок пуст» по недоступному LiveKit нельзя.
    if (isNotFound(error)) return [];
    throw error;
  }
}

export async function closeRoom(config: LiveKitConfig, room: string): Promise<void> {
  try {
    await roomService(config).deleteRoom(room);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function isNotFound(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  const message = String((error as { message?: unknown } | null)?.message ?? '');

  return status === 404 || /not.?found|does not exist/i.test(message);
}

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());

  return match ? match[1] : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** id вызывающего по его JWT — у сервера Auth, а не разбором токена здесь. */
export async function resolveCaller(
  request: Request,
  resolveUserId: (token: string) => Promise<string | null>,
  log: (message: string, error?: unknown) => void,
): Promise<string | null> {
  const token = bearerToken(request);

  if (!token) return null;

  try {
    return await resolveUserId(token);
  } catch (error) {
    log('resolveUserId failed', error);
    return null;
  }
}
