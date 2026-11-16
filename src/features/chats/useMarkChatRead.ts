import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { advanceHistoryRead, getHistoryRead, type Reached } from '@/api/historyRead';
import { localHistory } from './messages/local/database';
import { stillReader, useHistoryReader } from './messages/local/reader';
import { chatsQueryKey } from './chatsKey';

export const readKey = (reader: string, chat: string) => ['history-read', reader, chat] as const;

export async function fetchRead(reader: string, chat: string, signal: AbortSignal) {
  const state = await getHistoryRead(chat);
  if (signal.aborted || !stillReader(reader)) throw new Error('History reader changed');
  const db = localHistory();
  if (state) db.acknowledge({ reader, chat }, state);
  db.setRoute(reader, 'read-role/' + chat, !!state);
  db.setRoute(reader, 'first/' + chat, state?.first ?? null);
  return state;
}

export function refreshRead(client: QueryClient, reader: string, chat?: string) {
  if (!stillReader(reader)) return;
  void client.invalidateQueries({
    queryKey: chat ? readKey(reader, chat) : ['history-read', reader],
  });
  void client.invalidateQueries({ queryKey: chatsQueryKey });
  void client.invalidateQueries({
    predicate: ({ queryKey: k }) =>
      k[2] === 'subscription' &&
      (k[0] === 'channel' || (k[0] === 'chat' && (!chat || k[1] === chat))),
  });
}

// SQLite owns the queue. Only one sender per signed-in account; the acknowledgement
// deletes pending work only through the server's confirmed pair.
let wake: (() => void) | undefined;
export function HistoryReadDelivery() {
  const reader = useHistoryReader(),
    client = useQueryClient();
  useEffect(() => {
    if (!reader) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false,
      stopped = false;
    const active = () => !stopped && stillReader(reader);
    const schedule = (delay = 250) => {
      if (!active() || timer || running || !onlineManager.isOnline()) return;
      timer = setTimeout(() => {
        timer = undefined;
        void flush();
      }, delay);
    };
    const flush = async () => {
      if (!active() || running || !onlineManager.isOnline()) return;
      running = true;
      const db = localHistory();
      let retry = false;
      try {
        for (const p of db.pending(reader)) {
          if (!active()) break;
          try {
            const confirmed = await advanceHistoryRead(reader, p.chat, p);
            if (!active()) break;
            db.acknowledge({ reader, chat: p.chat }, confirmed);
            refreshRead(client, reader, p.chat);
          } catch (error) {
            if (!active()) break;
            if (
              error &&
              typeof error === 'object' &&
              'code' in error &&
              (error.code === '22023' || error.code === '42501')
            ) {
              db.discardPending({ reader, chat: p.chat }, p.key);
              refreshRead(client, reader, p.chat);
            } else retry = true;
          }
        }
      } finally {
        running = false;
        if (active() && db.pending(reader).length) schedule(retry ? 5000 : 0);
      }
    };
    wake = schedule;
    schedule();
    const off = onlineManager.subscribe((online) => {
      if (online) {
        refreshRead(client, reader);
        schedule();
      }
    });
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        refreshRead(client, reader);
        schedule();
      }
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      wake = undefined;
      off();
      sub.remove();
    };
  }, [client, reader]);
  return null;
}

export function useMarkChatRead(chat: string, enabled: boolean) {
  const reader = useHistoryReader();
  return useCallback(
    (point: Reached) => {
      if (!reader || !enabled || !stillReader(reader) || AppState.currentState !== 'active')
        return false;
      if (localHistory().reach({ reader, chat }, point)) wake?.();
      return true;
    },
    [reader, chat, enabled],
  );
}
