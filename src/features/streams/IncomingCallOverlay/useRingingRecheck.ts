import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { ChatKind } from '@/api/chats';
import { listRingingStreams, type LiveStream } from '@/api/streams';
import { RING_MS, ring } from '@/features/streams/incomingCall';

/**
 * Входящий мог пролететь мимо, пока приложение было в фоне: Realtime там
 * не слушает. При возврате на экран спрашиваем базу, не звонят ли мне прямо
 * сейчас, — и звоним, если ещё не поздно.
 */
export function useRingingRecheck(
  currentUserId: string | null,
  describe: (stream: LiveStream) => {
    chatTitle: string | null;
    chatKind: ChatKind;
    hostName: string;
  },
) {
  useEffect(() => {
    if (!currentUserId) return;

    const check = async () => {
      try {
        const since = new Date(Date.now() - RING_MS).toISOString();
        const streams = await listRingingStreams(currentUserId, since);

        for (const stream of streams) {
          ring({
            streamId: stream.id,
            chatId: stream.chatId,
            hostId: stream.hostId,
            startedAt: stream.startedAt,
            ...describe(stream),
          });
        }
      } catch {
        // Не вышло — узнаем о звонке по полосе в чате.
      }
    };

    void check();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });

    return () => subscription.remove();
  }, [currentUserId, describe]);
}
