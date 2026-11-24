import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { listChats, type ChatSummary } from '@/api/chats';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import { useHistoryReader } from './messages/local/reader';
import { routeOptions } from './messages/local/route';
import { describeLoadError } from '@/lib/network';

export { chatsQueryKey };

export type ChatsState = {
  chats: ChatSummary[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => void;
};

export function useChats(): ChatsState {
  const api = useRequestClient();
  const reader = useHistoryReader();
  const connection = useConnectionStatus();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data, isPending, fetchStatus, error, refetch } = useQuery({
    queryKey: chatsQueryKey,
    meta: { refreshOnUserChannelJoin: true },
    ...routeOptions(reader, 'chats', () => listChats(api)),
  });

  // Крутилка показывается только когда список тянут пальцем. Фоновое
  // обновление — например, после возвращения связи — идёт молча: иначе она
  // выскакивает сама по себе и выглядит сбоем.
  const refresh = useCallback(() => {
    setIsRefreshing(true);
    void refetch().finally(() => setIsRefreshing(false));
  }, [refetch]);

  return {
    chats: data ?? [],
    // Без связи запрос стоит на паузе. Показывать в этот момент крутилку —
    // значит врать, что данные вот-вот придут: они не придут, пока сети нет.
    isLoading: isPending && fetchStatus !== 'paused',
    isRefreshing,
    // Уже загруженное важнее сообщения о сбое, а про обрыв связи говорит шапка.
    error:
      data !== undefined || connection !== 'online'
        ? null
        : describeLoadError(error, 'Не удалось загрузить чаты'),
    refresh,
  };
}
