import { requestClient } from '@/api/requestClient';
import type { QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { listRingingStreams } from '@/api/streams';
import { cachedChat } from '@/features/chats/cachedChat';
import { RING_MS, ring } from './incomingCall';

/** Слушатель и его ответы принадлежат одной подтверждённой сессии. */
export function startRingingRecheck(client: QueryClient, api = requestClient()) {
  let active = true;

  async function check() {
    if (!active || api !== requestClient()) return;
    const since = new Date(Date.now() - RING_MS).toISOString();
    const streams = await listRingingStreams(since, api).catch(() => []);
    if (!active || api !== requestClient()) return;

    for (const stream of streams) {
      const chat = cachedChat(client, stream.chatId);
      const host = chat?.participants.find((person) => person.id === stream.hostId);
      ring({
        streamId: stream.id,
        chatId: stream.chatId,
        hostId: stream.hostId,
        startedAt: stream.startedAt,
        chatTitle: chat?.title ?? null,
        chatKind: chat?.kind ?? 'group',
        hostName: host?.displayName ?? 'Звонок',
      });
    }
  }

  void check();
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void check();
  });
  return () => {
    active = false;
    subscription.remove();
  };
}
