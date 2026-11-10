import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { getHistoryWindow } from '@/api/historyWindow';
import type { Message } from '@/api/messageRows';
import { mergeMessages, updateChatHistories } from '@/features/chats/messages/historyCache';
import type { ChatMessage } from '@/features/chats/messages/types';
import { showNotice } from '@/features/notifications/alertsStore';
import { islandItemKey } from './rows';

/** Whole-group selection is an explicit user action, never an automatic page load. */
export function useSelectForwardGroup(start: (keys: string[]) => void, userId: string | null) {
  const queryClient = useQueryClient();
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  return useCallback(
    async (island: ChatMessage) => {
      const request = ++generation.current;
      try {
        let page = await getHistoryWindow(island.chatId, {
          mode: 'around',
          messageId: island.id,
          limit: 1,
        });
        const messages: Message[] = [];
        while (true) {
          if (generation.current !== request) return;
          messages.push(
            ...page.items
              .filter((item) => item.messageId === island.id)
              .map((item) => item.message),
          );
          if (!page.after || page.items.some((item) => item.message.seq > island.seq)) break;
          page = await getHistoryWindow(island.chatId, { mode: 'after', cursor: page.after });
        }
        const group = mergeMessages({ items: [], nextCursor: null }, messages, 'older').items[0];
        if (!group?.forward) {
          showNotice('Пересылка недоступна', 'error');
          return;
        }
        updateChatHistories(queryClient, island.chatId, (history) =>
          history.items.some((message) => message.id === group.id)
            ? mergeMessages(history, [group], 'older')
            : history,
        );
        start(
          group.forward.items
            .filter((item) => item.original !== null || group.authorId === userId)
            .map((item) => islandItemKey(group.id, item.messageId)),
        );
      } catch {
        if (generation.current === request) showNotice('Не удалось загрузить пересылку', 'error');
      }
    },
    [queryClient, start, userId],
  );
}
