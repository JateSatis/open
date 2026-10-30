import type { QueryClient } from '@tanstack/react-query';

import type { Message } from '@/api/chats';
import {
  readChatThreadSummaries,
  refreshChatThreadSummaries,
} from '@/features/chats/chatThreads/summaries';
import { readChatThread, settleIntoChatThread } from '@/features/chats/chatThreads/threadCache';
import { mergeMessages, readHistory, updateHistory } from '@/features/chats/messages/historyCache';

/**
 * Своё подтверждённое сервером — в «Треды»: не-ответ встаёт в их ленту, ответ —
 * в загруженные шторки своих тредов, а плашки его корней перечитываются
 * (до того их держит оптимистичная прибавка).
 */
export function settleIntoChatThreads(queryClient: QueryClient, chatId: string, saved: Message) {
  const roots = saved.chatThreadRootIds ?? [];

  if (roots.length === 0) {
    if (readHistory(queryClient, chatId, 'chat-threads')) {
      updateHistory(
        queryClient,
        chatId,
        (history) => mergeMessages(history, [saved], 'newer'),
        'chat-threads',
      );
    }

    return;
  }

  roots.forEach((rootId) => {
    if (readChatThread(queryClient, chatId, rootId)) {
      settleIntoChatThread(queryClient, chatId, rootId, saved);
    }
  });

  if (readChatThreadSummaries(queryClient, chatId)) {
    refreshChatThreadSummaries(queryClient, chatId, roots).catch(() => undefined);
  }
}
