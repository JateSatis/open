import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { subscribeToChatSignals } from '@/api/chats';
import { listMessageClusters } from '@/api/fragmentClusters';
import { clustersKey, clustersKeyOf } from '@/features/chats/fragments/clusterKeys';
import { fragmentsKey } from '@/features/chats/fragments/useMessageFragments';

type ClusteredMessage = {
  id: string;
  chatId: string;
  text: string | null;
  /** Видимых фрагментов нет — кластеров тоже нет, спрашивать незачем. */
  fragmentsCount?: number;
  /** Спрашивать и без фрагментов — панель кластера знает, что он есть. */
  always?: boolean;
};

/**
 * Отображаемые кластеры фрагментов сообщения — диапазоны в UTF-16 его
 * текста, счётчики и моя реакция в кластере. Пересчёт на сервере сообщает о
 * новых кластерах сигналом `clusters_changed` в топик чата — тогда
 * перечитываются. Сообщение без фрагментов кластеры не спрашивает, пока
 * такой сигнал не придёт: первый кластер появляется и у облачка, загруженного
 * до первой реакции.
 */
export function useMessageClusters(message: ClusteredMessage | null) {
  const queryClient = useQueryClient();
  const messageId = message?.id ?? null;
  const chatId = message?.chatId ?? null;
  const text = message?.text ?? '';
  const [signalled, setSignalled] = useState<string | null>(null);
  const enabled =
    messageId !== null &&
    text !== '' &&
    ((message?.fragmentsCount ?? 0) > 0 || message?.always === true || signalled === messageId);

  const query = useQuery({
    queryKey: clustersKey(messageId ?? '', text),
    queryFn: () => listMessageClusters(messageId!, text),
    enabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!messageId || !chatId || text === '') return;

    const refresh = () => void queryClient.invalidateQueries({ queryKey: clustersKeyOf(messageId) });

    return subscribeToChatSignals(chatId, {
      onClustersChanged: (changed) => {
        if (changed !== messageId) return;

        setSignalled(messageId);
        refresh();
        // Пересчёт перекладывает фрагменты по кластерам — их кластер тоже свежий.
        void queryClient.invalidateQueries({ queryKey: fragmentsKey(messageId) });
      },
      onReconnected: refresh,
    });
  }, [messageId, chatId, text, queryClient]);

  return query;
}
