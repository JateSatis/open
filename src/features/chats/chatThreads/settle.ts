import type { QueryClient } from '@tanstack/react-query';

import type { Message } from '@/api/chats';
import {
  readChatThreadSummaries,
  refreshChatThreadSummaries,
  chatThreadSummariesKey,
  takeDeferredChatThreadRoots,
  withPendingChatThreadSummaries,
  type ChatThreadSummaries,
} from '@/features/chats/chatThreads/summaries';
import { readChatThread, settleIntoChatThread } from '@/features/chats/chatThreads/chatThreadCache';
import { mergeMessages, readHistory, updateHistory } from '@/features/chats/messages/historyCache';

/** Завершение неудачной/отменённой отправки снимает отсрочку Broadcast-сводок. */
export function refreshSettledChatThreadSummaries(queryClient: QueryClient, chatId: string) {
  const known = readChatThreadSummaries(queryClient, chatId);
  const roots = [...Object.keys(known ?? {}), ...takeDeferredChatThreadRoots(chatId)];
  if (roots.length > 0) refreshChatThreadSummaries(queryClient, chatId, roots).catch(() => undefined);
}

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
    // Между подтверждением отправки и ответом сводки прибавку держит уже
    // подтверждённое сообщение. Broadcast мог принести сводку раньше — тогда
    // номер последнего ответа не меньше saved.seq и второй прибавки нет.
    queryClient.setQueryData<ChatThreadSummaries>(chatThreadSummariesKey(chatId), (current) => {
      if (!current || !saved.authorId || !saved.author) return current;
      const missing = roots.filter((rootId) => (current[rootId]?.last?.seq ?? 0) < saved.seq);
      const next = withPendingChatThreadSummaries(current, [{ ...saved, status: 'sending',
        chatThreadRootIds: missing, chatThreadPendingAuthor: {
          id: saved.authorId, name: saved.author.displayName, avatarUrl: saved.author.avatarUrl,
        },
      }]);
      missing.forEach((rootId) => {
        if (next[rootId]?.last) next[rootId] = { ...next[rootId]!, last: { ...next[rootId]!.last!, seq: saved.seq } };
      });
      return next;
    });
    refreshChatThreadSummaries(queryClient, chatId, roots).catch(() => undefined);
  }
}
