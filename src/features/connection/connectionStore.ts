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
let status: ConnectionStatus = 'connecting';

const listeners = new Set<() => void>();

function derive(): ConnectionStatus {
  // Сокет живёт — связь точно есть.
  if (realtime === 'joined') return 'online';
  // Сокет ещё поднимается, но запросы проходят: данные ходят, значит связь есть.
  if (requests === 'ok') return 'online';
  if (requests === 'failed') return 'offline';

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

export function reportRealtimeJoined() {
  realtime = 'joined';
  requests = 'ok';
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
  publish();
}

/**
 * Запрос не дошёл до сервера. Сокет при этом считаем упавшим, даже если он
 * ещё не успел это заметить: сеть общая.
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
  status = 'connecting';
  onlineManager.setOnline(true);
  listeners.clear();
}
