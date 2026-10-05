import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { getChatReadUpTo, subscribeToChatSignals } from '@/api/chats';
import { messagesQueryKey } from '@/features/chats/messages/historyCache';
import {
  dropDeletedMessages,
  patchOriginChat,
  refreshCommentCounts,
  refreshEditedMessages,
  refreshReactions,
  refreshViews,
} from '@/features/chats/messages/sync';
import type { ChatMessage } from '@/features/chats/messages/types';

/** Столько копить события реакций и комментариев, прежде чем перечитать, — как в канале чата. */
const BATCH_MS = 500;

type Refresh = (queryClient: QueryClient, ids: string[]) => Promise<void>;

/** Копит id и перечитывает их пачкой: на горячий оригинал события сыплются десятками. */
function batcher(queryClient: QueryClient, refresh: Refresh) {
  const ids = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    add(id: string) {
      ids.add(id);

      if (timer) return;

      timer = setTimeout(() => {
        const batch = [...ids];

        ids.clear();
        timer = null;
        // Не вышло — дочитаем при следующем событии или переподключении.
        refresh(queryClient, batch).catch(() => undefined);
      }, BATCH_MS);
    },
    stop() {
      if (timer) clearTimeout(timer);

      timer = null;
      ids.clear();
    },
  };
}

/** Чаты оригиналов в загруженных островках, кроме этого — его канал и так открыт. */
function sourceChats(chatId: string, messages: ChatMessage[]): string {
  const ids = new Set<string>();

  for (const message of messages) {
    for (const item of message.forward?.items ?? []) {
      if (item.original && item.original.chatId !== chatId) ids.add(item.original.chatId);
    }
  }

  return [...ids].sort().join(',');
}

/**
 * Сигналы об оригиналах островков. Правки, удаления, реакции и комментарии
 * оригинала уходят в топик его чата, а не туда, где висит островок, —
 * поэтому экран слушает топики чатов-источников загруженных островков.
 * Раздача по всем чатам с островками на сервере не масштабировалась бы:
 * горячее сообщение могут переслать в тысячи чатов.
 *
 * Каналы общие (`chatTopics`): открытый исходный чат и островок здесь не
 * мешают друг другу, отписка одного не глушит другого.
 */
export function useIslandSources(chatId: string, messages: ChatMessage[]) {
  const queryClient = useQueryClient();
  const sources = useMemo(() => sourceChats(chatId, messages), [chatId, messages]);

  useEffect(() => {
    if (!sources) return;

    const reactions = batcher(queryClient, refreshReactions);
    const comments = batcher(queryClient, refreshCommentCounts);
    const views = batcher(queryClient, refreshViews);

    const releases = sources.split(',').map((sourceId) =>
      subscribeToChatSignals(sourceId, {
        onMessagesDeleted: (ids) => {
          dropDeletedMessages(queryClient, ids).catch(() => undefined);
        },
        onMessageEdited: (id) => {
          refreshEditedMessages(queryClient, [id]).catch(() => undefined);
        },
        onReactionsChanged: (id) => reactions.add(id),
        onCommentsChanged: (id) => comments.add(id),
        onViewsChanged: (ids) => ids.forEach((id) => views.add(id)),
        onRead: () => {
          getChatReadUpTo(sourceId)
            .then((readUpTo) => patchOriginChat(queryClient, sourceId, readUpTo))
            .catch(() => undefined);
        },
        // Пока канала не было, события терялись: дочитывание истории этого
        // чата сверяет и оригиналы в его островках.
        onReconnected: () => {
          void queryClient.invalidateQueries({ queryKey: messagesQueryKey(chatId) });
        },
      }),
    );

    return () => {
      releases.forEach((release) => release());
      reactions.stop();
      comments.stop();
      views.stop();
    };
  }, [chatId, queryClient, sources]);
}
