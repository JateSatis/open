import { onlineManager } from '@tanstack/react-query';

// Состояние связи с сервером — одно на всё приложение.
//
// Оно намеренно не спрашивает у системы, есть ли Wi-Fi: подключённая сеть без
// доступа наружу — обычное дело, и пользователю от такой «связи» толку нет.
// Судим по тому, что видим сами: держится ли сокет Realtime и проходят ли
// запросы. Это же и определяет, когда можно всё дозагрузить.

export type ConnectionStatus = 'online' | 'connecting' | 'offline';

type RealtimeState = 'joined' | 'down';
type RequestState = 'ok' | 'failed' | 'unknown';

let realtime: RealtimeState = 'down';
let requests: RequestState = 'unknown';
let deviceOffline = false;
let status: ConnectionStatus = 'connecting';

const listeners = new Set<() => void>();

function derive(): ConnectionStatus {
  // Система говорит, что подключения нет вообще. Это единственный сигнал,
  // который приходит мгновенно, и спорить с ним бессмысленно: без сети не
  // поможет ни живой сокет из прошлого, ни удачный запрос минуту назад.
  if (deviceOffline) return 'offline';

  // Сокет живёт — связь точно есть.
  if (realtime === 'joined') return 'online';
  // Сокет ещё поднимается, но запросы проходят: данные ходят, значит связь есть.
  if (requests === 'ok') return 'online';

  // Сеть на устройстве есть, а сервер не отвечает — это «подключение», а не
  // «нет сети». Разница не косметическая: раньше каждая неудачная проба
  // роняла состояние в «нет сети», и после возвращения сети оно прыгало
  // туда-сюда, ни разу не дойдя до рабочего.
  return 'connecting';
}

function publish() {
  const next = derive();

  if (next === status) return;

  status = next;
  // Пока связи нет, TanStack Query не должен долбиться в сеть; как только она
  // появляется, он сам перезапрашивает всё, что успело устареть.
  onlineManager.setOnline(next !== 'offline');

  for (const listener of listeners) {
    listener();
  }
}

export function getConnectionStatus(): ConnectionStatus {
  return status;
}

export function subscribeToConnectionStatus(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Сеть на устройстве пропала или появилась — по данным системы.
 *
 * Появление сети не означает, что сервер доступен, поэтому «онлайн» отсюда не
 * объявляется: состояние возвращается к тому, что известно из сокета и
 * запросов, а проба уточнит остальное.
 */
export function reportDeviceNetwork(connected: boolean) {
  deviceOffline = !connected;

  if (!connected) {
    realtime = 'down';
    requests = 'failed';
  }

  publish();
}

export function reportRealtimeJoined() {
  realtime = 'joined';
  requests = 'ok';
  // Живой сокет — прямое доказательство связи, оно сильнее мнения системы:
  // та может сообщить о появлении сети с заметной задержкой.
  deviceOffline = false;
  publish();
}

/**
 * Сокет отвалился. Про запросы в этот момент ничего не известно: сеть могла
 * пропасть, а могло упасть только соединение — поэтому не «нет сети», а
 * «подключаемся», пока что-нибудь не прояснится.
 */
export function reportRealtimeDown() {
  realtime = 'down';
  requests = 'unknown';
  publish();
}

export function reportRequestSucceeded() {
  requests = 'ok';
  // Запрос дошёл до сервера — значит сеть есть, что бы ни считала система.
  deviceOffline = false;
  publish();
}

/**
 * Запрос не дошёл до сервера. Сокет при этом считаем упавшим, даже если он
 * ещё не успел это заметить: сеть общая. «Нет сети» из этого не следует —
 * недоступен может быть и один сервер.
 */
export function reportRequestFailed() {
  realtime = 'down';
  requests = 'failed';
  publish();
}

/** Только для тестов: вернуть состояние к исходному. */
export function resetConnectionState() {
  realtime = 'down';
  requests = 'unknown';
  deviceOffline = false;
  status = 'connecting';
  onlineManager.setOnline(true);
  listeners.clear();
}
