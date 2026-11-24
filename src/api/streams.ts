// Звонки — публичные эфиры из чата. Читать звонок может любой: эфир публичен.
// Начать его может только участник чата — это проверяет `start_call` в базе,
// а говорить или только слушать — решает токен, который выдаёт Edge Function
// `livekit-token`. Секрет LiveKit клиент не видит никогда: адрес комнаты и
// токен приходят из функции вместе.

import { requestClient } from '@/api/requestClient';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { opaqueFlag } from '@/api/opaquePeople';

export type StreamRole = 'host' | 'speaker' | 'listener';

export type LiveStream = {
  id: string;
  chatId: string;
  hostId: string | null;
  startedAt: string;
  /** Сейчас в звонке участников чата (говорящих). */
  speakersCount: number;
  listenersCount: number;
};

export type StreamStatus = { id: string; status: 'live' | 'ended'; endedAt: string | null };

export type StreamJoin = {
  token: string;
  url: string;
  role: StreamRole;
  streamId: string;
  chatId: string;
};

/** Почему не удалось войти в звонок — из ответа функции, без сырых ошибок. */
export class StreamJoinError extends Error {
  constructor(
    readonly reason: 'ended' | 'not_found' | 'unauthorized' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'StreamJoinError';
  }
}

type StreamRow = {
  id: string;
  chat_id: string;
  host_id: string | null;
  started_at: string;
  speakers_count: number;
  listeners_count: number;
};

// Колонки результата rpc генератор типов не размечает как nullable.
function toLiveStream(row: StreamRow): LiveStream {
  return {
    id: row.id,
    chatId: row.chat_id,
    hostId: row.host_id ?? null,
    startedAt: row.started_at,
    speakersCount: row.speakers_count,
    listenersCount: row.listeners_count,
  };
}

/**
 * Идущий звонок чата или null. Живой в чате не больше одного — это инвариант
 * базы. Начавший — глазами смотрящего: подменённому в диалоге — непрозрачный id.
 */
export async function fetchLiveStream(chatId: string, api = requestClient()): Promise<LiveStream | null> {
  const { data, error } = await api.rpc('chat_live_stream', { target_chat: chatId });

  if (error) throw error;

  const [row] = data ?? [];

  return row ? toLiveStream(row) : null;
}

export async function fetchStreamStatus(streamId: string, api = requestClient()): Promise<StreamStatus | null> {
  const { data, error } = await api
    .from('streams')
    .select('id, status, ended_at')
    .eq('id', streamId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    status: data.status === 'ended' ? 'ended' : 'live',
    endedAt: data.ended_at,
  };
}

/**
 * Звонки, которые мне сейчас звонят: живые, начатые не мной в чатах, где я
 * участник, не раньше `since` и без моего входа. Нужны, когда входящий
 * пролетел мимо — приложение было в фоне или канал переподключался.
 */
export async function listRingingStreams(since: string, api = requestClient()): Promise<LiveStream[]> {
  const { data, error } = await api.rpc('my_ringing_streams', { since });

  if (error) throw error;

  return (data ?? []).map(toLiveStream);
}

/**
 * Начинает звонок или возвращает уже идущий: два одновременных нажатия
 * ведут в один звонок, это решает база под блокировкой.
 */
export async function startCall(chatId: string, api = requestClient()): Promise<{ streamId: string; created: boolean }> {
  const { data, error } = await api.rpc('start_call', { target_chat: chatId });

  if (error) throw error;

  const result = data as { stream_id?: unknown; created?: unknown } | null;

  if (typeof result?.stream_id !== 'string') throw new Error('Не удалось начать звонок');

  return { streamId: result.stream_id, created: result.created === true };
}

async function errorCode(error: unknown): Promise<{ status: number; code: string | null }> {
  if (!(error instanceof FunctionsHttpError)) return { status: 0, code: null };

  const response = error.context as Response;

  try {
    const body = (await response.json()) as { error?: unknown };

    return { status: response.status, code: typeof body.error === 'string' ? body.error : null };
  } catch {
    return { status: response.status, code: null };
  }
}

/** Токен входа в звонок. Роль решает сервер: участник чата говорит, остальные слушают. */
export async function requestStreamToken(streamId: string, api = requestClient()): Promise<StreamJoin> {
  const { data, error } = await api.functions.invoke('livekit-token', {
    body: { stream_id: streamId },
  });

  if (error) {
    const { status } = await errorCode(error);

    if (status === 410) throw new StreamJoinError('ended', 'Звонок уже завершён');
    if (status === 404) throw new StreamJoinError('not_found', 'Звонок не найден');
    if (status === 401)
      throw new StreamJoinError('unauthorized', 'Войдите заново, чтобы присоединиться');

    throw new StreamJoinError('unavailable', 'Не удалось подключиться к звонку');
  }

  const body = data as Record<string, unknown> | null;
  const role = body?.role;

  if (
    typeof body?.token !== 'string' ||
    typeof body.url !== 'string' ||
    (role !== 'host' && role !== 'speaker' && role !== 'listener')
  ) {
    throw new StreamJoinError('unavailable', 'Не удалось подключиться к звонку');
  }

  return {
    token: body.token,
    url: body.url,
    role,
    streamId: typeof body.stream_id === 'string' ? body.stream_id : streamId,
    chatId: typeof body.chat_id === 'string' ? body.chat_id : '',
  };
}

/**
 * Просит сервер сверить звонок с LiveKit: если в нём давно никто не говорит,
 * а вебхук о выходе потерялся, звонок завершится. Результат не нужен —
 * перемены придут событием `stream_changed`.
 */
export async function syncStream(streamId: string, api = requestClient()): Promise<void> {
  await api.functions.invoke('livekit-sync', { body: { stream_id: streamId } });
}

/**
 * Человек в звонке. `identity` — как его знает комната LiveKit: не id
 * человека, а непрозрачный id этого звонка, имени в комнате нет вовсе.
 */
export type CallPerson = {
  identity: string;
  /** Id глазами смотрящего; `opaque` — непрозрачный, профиля за ним нет. */
  userId: string;
  opaque: boolean;
  displayName: string;
  avatarUrl: string | null;
};

/** Кто сейчас в звонке — глазами смотрящего, в контексте чата звонка. */
export async function listCallPeople(streamId: string, api = requestClient()): Promise<CallPerson[]> {
  const { data, error } = await api.rpc('stream_people', { target_stream: streamId });

  if (error) throw error;

  // Колонки результата rpc генератор типов не размечает как nullable.
  return (data ?? []).map((row) => ({
    identity: row.identity,
    userId: row.user_id,
    opaque: opaqueFlag(row.user_id, row.opaque),
    displayName: row.display_name ?? 'Без имени',
    avatarUrl: row.avatar_url ?? null,
  }));
}
