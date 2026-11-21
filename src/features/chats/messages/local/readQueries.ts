import type { QueryClient } from '@tanstack/react-query';
import { getHistoryRead } from '@/api/historyRead';
import { chatsQueryKey } from '../../chatsKey';
import { localHistory } from './database';
import { stillReader } from './reader';

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
