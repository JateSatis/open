import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Room, RoomEvent, dispose } from '@livekit/rtc-node';
import { RoomServiceClient } from 'livekit-server-sdk';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const env = readEnvFile(resolve(ROOT, 'infra', '.env'));
const API_URL = required(env, 'SUPABASE_PUBLIC_URL').replace(/\/+$/, '');
const API_DOMAIN = required(env, 'API_DOMAIN');
const LIVEKIT_DOMAIN = required(env, 'LIVEKIT_DOMAIN');
const ANON_KEY = required(env, 'ANON_KEY');
const SERVICE_KEY = required(env, 'SERVICE_ROLE_KEY');
const LIVEKIT_API_KEY = required(env, 'LIVEKIT_API_KEY');
const LIVEKIT_API_SECRET = required(env, 'LIVEKIT_API_SECRET');
const LIVEKIT_URL = `wss://${LIVEKIT_DOMAIN}`;
const roomService = new RoomServiceClient(
  `https://${LIVEKIT_DOMAIN}`,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

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

async function request(path, { method = 'GET', key, token, body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (key) requestHeaders.apikey = key;
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
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

function encoded(value) {
  return encodeURIComponent(value);
}

async function waitFor(label, read, accept, timeoutMs = 15_000) {
  const started = Date.now();
  let value;
  while (Date.now() - started < timeoutMs) {
    value = await read();
    if (accept(value)) return value;
    await sleep(300);
  }
  throw new Error(`${label} не подтвердился за ${timeoutMs / 1000} секунд.`);
}

async function queryRows(table, query) {
  const result = await request(`/rest/v1/${table}?${query}`, {
    key: SERVICE_KEY,
    token: SERVICE_KEY,
  });
  assert(result.response.ok, `Чтение ${table} завершилось HTTP ${result.response.status}.`);
  return result.data;
}

async function createTemporaryUser(email, onCreated) {
  const created = await request('/auth/v1/admin/users', {
    method: 'POST',
    key: SERVICE_KEY,
    token: SERVICE_KEY,
    body: { email, email_confirm: true, user_metadata: { full_name: 'LiveKit migration check' } },
  });
  assert(
    created.response.ok && created.data?.id,
    'Не удалось создать временного Auth-пользователя.',
  );
  onCreated(created.data.id);

  const magicLink = await request('/auth/v1/admin/generate_link', {
    method: 'POST',
    key: SERVICE_KEY,
    token: SERVICE_KEY,
    body: { type: 'magiclink', email },
  });
  const tokenHash = magicLink.data?.hashed_token;
  assert(magicLink.response.ok && tokenHash, 'Не удалось получить временную Auth-сессию.');

  const verified = await request('/auth/v1/verify', {
    method: 'POST',
    key: ANON_KEY,
    body: { type: 'magiclink', token_hash: tokenHash },
  });
  assert(
    verified.response.ok && verified.data?.access_token,
    'Не удалось подтвердить временную сессию.',
  );
  return { id: created.data.id, accessToken: verified.data.access_token };
}

async function removeTemporaryData({ userId, chatId, streamId, roomName, room }) {
  const errors = [];
  if (room) {
    try {
      await room.disconnect();
    } catch {
      errors.push('Не удалось отключить тестового LiveKit-участника.');
    }
  }
  if (roomName) {
    try {
      await roomService.deleteRoom(roomName);
    } catch (error) {
      if (!/not.?found|does not exist/i.test(String(error?.message ?? ''))) {
        errors.push('Не удалось закрыть тестовую комнату LiveKit.');
      }
    }
  }
  if (streamId) {
    try {
      const finished = await request('/rest/v1/rpc/finish_stream', {
        method: 'POST',
        key: SERVICE_KEY,
        token: SERVICE_KEY,
        body: { target_stream: streamId, reason: 'abandoned' },
      });
      if (!finished.response.ok)
        errors.push('Не удалось завершить временный звонок перед очисткой.');
    } catch {
      errors.push('Не удалось завершить временный звонок перед очисткой.');
    }
  }
  if (chatId) {
    try {
      const removed = await request(`/rest/v1/chats?id=eq.${encoded(chatId)}`, {
        method: 'DELETE',
        key: SERVICE_KEY,
        token: SERVICE_KEY,
      });
      if (!removed.response.ok) errors.push('Не удалось удалить тестовый чат и связанные записи.');
    } catch {
      errors.push('Не удалось удалить тестовый чат и связанные записи.');
    }
  }
  if (userId) {
    try {
      const removed = await request(`/auth/v1/admin/users/${encoded(userId)}`, {
        method: 'DELETE',
        key: SERVICE_KEY,
        token: SERVICE_KEY,
      });
      if (!removed.response.ok && removed.response.status !== 404)
        errors.push('Не удалось удалить тестового пользователя.');
      const remaining = await request(`/auth/v1/admin/users/${encoded(userId)}`, {
        key: SERVICE_KEY,
        token: SERVICE_KEY,
      });
      if (remaining.response.ok) errors.push('Тестовый Auth-пользователь остался после очистки.');
      else if (remaining.response.status !== 404)
        errors.push('Не удалось проверить удаление тестового пользователя.');
    } catch {
      errors.push('Не удалось проверить удаление тестового пользователя.');
    }
  }
  if (streamId) {
    try {
      const rows = await queryRows('streams', `select=id&id=eq.${encoded(streamId)}`);
      if (rows.length) errors.push('Тестовая запись streams осталась после очистки.');
    } catch {
      errors.push('Не удалось проверить очистку тестовой записи звонка.');
    }
  }
  if (chatId) {
    try {
      const rows = await queryRows('chats', `select=id&id=eq.${encoded(chatId)}`);
      if (rows.length) errors.push('Тестовый чат остался после очистки.');
    } catch {
      errors.push('Не удалось проверить удаление тестового чата.');
    }
  }
  return errors;
}

const publicApi = await fetch(`https://${API_DOMAIN}/health`);
assert(publicApi.ok, `Публичный API через Caddy недоступен (HTTP ${publicApi.status}).`);
const publicLiveKit = await fetch(LIVEKIT_URL.replace(/^wss:/, 'https:'));
assert(
  publicLiveKit.ok && (await publicLiveKit.text()).trim() === 'OK',
  'HTTPS LiveKit через Caddy не вернул OK.',
);

const email = `livekit-check-${randomUUID()}@example.invalid`;
let userId;
let accessToken;
let chatId;
let streamId;
let roomName;
let room;
let succeeded = false;
let primaryError;

try {
  const user = await createTemporaryUser(email, (id) => {
    userId = id;
  });
  userId = user.id;
  accessToken = user.accessToken;

  const chat = await request('/rest/v1/chats', {
    method: 'POST',
    key: SERVICE_KEY,
    token: SERVICE_KEY,
    headers: { Prefer: 'return=representation' },
    body: { kind: 'group', title: 'LiveKit migration check', created_by: userId },
  });
  assert(
    chat.response.ok && chat.data?.[0]?.id,
    `Не удалось создать тестовый чат (${chat.response.status}).`,
  );
  chatId = chat.data[0].id;

  const member = await request('/rest/v1/chat_members', {
    method: 'POST',
    key: SERVICE_KEY,
    token: SERVICE_KEY,
    body: { chat_id: chatId, user_id: userId },
  });
  assert(
    member.response.ok,
    `Не удалось добавить тестового участника в чат (${member.response.status}).`,
  );

  const started = await request('/rest/v1/rpc/start_call', {
    method: 'POST',
    key: ANON_KEY,
    token: accessToken,
    body: { target_chat: chatId },
  });
  assert(
    started.response.ok && started.data?.created === true && started.data?.stream_id,
    `start_call не создал тестовый звонок (${started.response.status}).`,
  );
  streamId = started.data.stream_id;
  const [stream] = await queryRows(
    'streams',
    `select=id,room_name,status&id=eq.${encoded(streamId)}`,
  );
  assert(stream?.status === 'live', 'Созданный тестовый звонок не активен.');
  roomName = stream.room_name;

  const tokenResult = await request('/functions/v1/livekit-token', {
    method: 'POST',
    key: ANON_KEY,
    token: accessToken,
    body: { stream_id: streamId },
  });
  assert(tokenResult.response.ok, `livekit-token вернул HTTP ${tokenResult.response.status}.`);
  assert(
    tokenResult.data?.url === LIVEKIT_URL &&
      tokenResult.data?.role === 'host' &&
      tokenResult.data?.token,
    'livekit-token не вернул ожидаемые url, token и роль host.',
  );
  const identities = await queryRows(
    'stream_identities',
    `select=identity,stream_id,user_id&stream_id=eq.${encoded(streamId)}&user_id=eq.${encoded(userId)}`,
  );
  assert(
    identities.length === 1 && identities[0].identity !== userId,
    'stream_identities не содержит уникальный непрозрачный identity.',
  );
  console.log('livekit-token: публичный WSS URL, host JWT и непрозрачный identity подтверждены.');

  room = new Room();
  let connectedEvent = false;
  room.on(RoomEvent.Connected, () => {
    connectedEvent = true;
  });
  await room.connect(tokenResult.data.url, tokenResult.data.token, { autoSubscribe: true });
  assert(room.isConnected, 'LiveKit SDK не установил соединение с комнатой.');
  const sid = room.localParticipant?.sid;
  assert(sid, 'LiveKit не назначил идентификатор тестовому подключению.');

  const joined = await waitFor(
    'вебхук participant_joined и stream_participants',
    async () => {
      const rows = await queryRows(
        'stream_participants',
        `select=user_id,role,left_at,livekit_sid&stream_id=eq.${encoded(streamId)}&user_id=eq.${encoded(userId)}`,
      );
      return rows[0];
    },
    (row) => row?.left_at === null && row?.role === 'host' && row?.livekit_sid === sid,
  );
  assert(joined, 'Вебхук LiveKit не записал вошедшего host.');
  console.log(
    `open-livekit: реальное подключение подтверждено${connectedEvent ? ' событием Connected' : ''}; подписанный вебхук обновил stream_participants.`,
  );

  const synced = await request('/functions/v1/livekit-sync', {
    method: 'POST',
    key: ANON_KEY,
    token: accessToken,
    body: { stream_id: streamId },
  });
  assert(
    synced.response.ok && synced.data?.outcome === 'ok',
    `livekit-sync не завершился со статусом ok (${synced.response.status}, ${synced.data?.outcome ?? 'нет результата'}).`,
  );
  const afterSync = await queryRows(
    'stream_participants',
    `select=left_at,livekit_sid&stream_id=eq.${encoded(streamId)}&user_id=eq.${encoded(userId)}`,
  );
  assert(
    afterSync[0]?.left_at === null && afterSync[0]?.livekit_sid === sid,
    'livekit-sync не сверил активного участника через LiveKit.',
  );
  console.log('livekit-sync: RPC reconcile_stream синхронизировал реального участника (HTTP 200).');

  await room.disconnect();
  const finalState = await waitFor(
    'participant_left и завершение звонка',
    async () => {
      const [currentStream] = await queryRows(
        'streams',
        `select=status,ended_at,end_reason&id=eq.${encoded(streamId)}`,
      );
      const participants = await queryRows(
        'stream_participants',
        `select=left_at,livekit_sid&stream_id=eq.${encoded(streamId)}&user_id=eq.${encoded(userId)}`,
      );
      return { currentStream, participant: participants[0] };
    },
    ({ currentStream, participant }) =>
      currentStream?.status === 'ended' &&
      Boolean(participant?.left_at) &&
      participant?.livekit_sid === null,
    30_000,
  );

  const [callEndedMessage] = await queryRows(
    'messages',
    `select=id&stream_id=eq.${encoded(streamId)}&system_event=eq.call_ended`,
  );
  assert(callEndedMessage, 'stream_room_finished не завершил звонок и не записал call_ended.');
  const liveRooms = await roomService.listRooms([roomName]);
  assert(
    !liveRooms.some((candidate) => candidate.name === roomName),
    'Комната осталась открыта в open-livekit после выхода участника.',
  );
  console.log(
    `webhooks participant_left / room_finished: звонок завершён (${finalState.currentStream.end_reason}), сообщение записано, комната закрыта.`,
  );
  succeeded = true;
} catch (error) {
  primaryError = error;
} finally {
  const cleanupErrors = await removeTemporaryData({ userId, chatId, streamId, roomName, room });
  try {
    await dispose();
  } catch {
    cleanupErrors.push('Не удалось завершить LiveKit RTC runtime.');
  }
  if (cleanupErrors.length) {
    const cleanupMessage = `Очистка тестовых данных завершилась с ошибками: ${cleanupErrors.join(' ')}`;
    if (primaryError) primaryError = new Error(`${primaryError.message} ${cleanupMessage}`);
    else primaryError = new Error(cleanupMessage);
  }
}

if (primaryError) throw primaryError;
assert(succeeded, 'Сквозная проверка LiveKit не завершилась.');
console.log('Тестовые звонок, чат, пользователь и связанные строки полностью удалены.');
