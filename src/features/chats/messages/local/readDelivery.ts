import type { QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { advanceHistoryRead } from '@/api/historyRead';
import {
  confirmedSessionOwner,
  isCurrentSession,
  sameSession,
  type SessionOwner,
} from '@/features/auth/sessionOwner';
import { useSessionStore } from '@/features/auth/sessionState';
import {
  getConnectionStatus,
  subscribeToConnectionStatus,
} from '@/features/connection/connectionStore';
import { localHistory } from './database';
import { refreshRead } from './readQueries';
import { compare } from './segments';

const COALESCE_MS = 250;
const RETRY_MS = 5000;

function rejectedPoint(error: unknown) {
  return (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === '22023' || error.code === '42501')
  );
}

function bindQueue(owner: SessionOwner, client: QueryClient) {
  const reader = owner.userId;
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offReached: (() => void) | undefined;
  const current = () => !stopped && isCurrentSession(owner);
  const canSend = () => current() && getConnectionStatus() === 'online';

  function schedule(delay = COALESCE_MS) {
    if (timer !== undefined || running || !canSend()) return;
    timer = setTimeout(() => {
      timer = undefined;
      void processQueue();
    }, delay);
  }

  async function processQueue() {
    if (!canSend()) return;
    const db = localHistory();
    // Отметки, записанные до первого прохода (в том числе в прошлом процессе),
    // уже попадут в pending. Подписка нужна только для последующих записей.
    offReached ??= db.onReached((changedReader) => {
      if (changedReader === reader) schedule();
    });
    running = true;
    let retry = false;
    try {
      for (const point of db.pending(reader)) {
        if (!canSend()) break;
        const scope = { reader, chat: point.chat };
        try {
          const confirmed = await advanceHistoryRead(reader, point.chat, point);
          if (!current()) return;
          db.acknowledge(scope, confirmed);
          if (compare(confirmed, point) < 0) retry = true;
        } catch (error) {
          if (!current()) return;
          if (!rejectedPoint(error)) {
            retry = true;
            continue;
          }
          db.discardPending(scope, point.key);
        }
        refreshRead(client, reader, point.chat);
      }
    } finally {
      running = false;
      if (canSend() && db.pending(reader).length) schedule(retry ? RETRY_MS : 0);
    }
  }

  const offConnection = subscribeToConnectionStatus(() => schedule());
  const app = AppState.addEventListener('change', (state) => {
    if (state === 'active' && current()) {
      refreshRead(client, reader);
      schedule();
    }
  });
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    offReached?.();
    offConnection();
    app.remove();
  };
}

export function startHistoryReadDelivery(reader: string | null, client: QueryClient) {
  if (!reader) return;
  let bound: SessionOwner | null = null;
  let stop: (() => void) | undefined;
  function sync() {
    const confirmed = confirmedSessionOwner();
    const owner = confirmed?.userId === reader ? confirmed : null;
    if (sameSession(bound, owner)) return;
    stop?.();
    bound = owner;
    stop = owner ? bindQueue(owner, client) : undefined;
  }
  const unsubscribe = useSessionStore.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    stop?.();
  };
}
