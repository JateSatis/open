import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { acquireChatTopic } from '@/api/chatTopics';
import { listMessageClusters } from '@/api/fragmentClusters';

/** Отображаемые кластеры сообщения в кеше. Текст — в ключе: правка перечитывает. */
export function clustersKey(messageId: string, text: string) {
  return ['fragmentClusters', messageId, text] as const;
}

type ClusteredMessage = {
  id: string;
  chatId: string;
  text: string | null;
  /** Видимых фрагментов нет — кластеров тоже нет, спрашивать незачем. */
  fragmentsCount?: number;
};

/**
 * Отображаемые кластеры фрагментов сообщения — диапазоны в UTF-16 его
 * текста, счётчики и моя реакция в кластере. Пересчёт на сервере сообщает о
 * новых кластерах сигналом `clusters_changed` в топик чата — тогда
 * перечитываются.
 */
export function useMessageClusters(message: ClusteredMessage | null) {
  const queryClient = useQueryClient();
  const messageId = message?.id ?? null;
  const chatId = message?.chatId ?? null;
  const text = message?.text ?? '';
  const enabled = messageId !== null && text !== '' && (message?.fragmentsCount ?? 0) > 0;

  const query = useQuery({
    queryKey: clustersKey(messageId ?? '', text),
    queryFn: () => listMessageClusters(messageId!, text),
    enabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!enabled || !messageId || !chatId) return;

    const refresh = () =>
      void queryClient.invalidateQueries({ queryKey: ['fragmentClusters', messageId] });

    return acquireChatTopic(chatId, {
      onClustersChanged: (changed) => {
        if (changed === messageId) refresh();
      },
      onReconnected: refresh,
    }).release;
  }, [enabled, messageId, chatId, queryClient]);

  return query;
}
