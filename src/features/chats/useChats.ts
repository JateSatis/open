import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { listChats, type ChatSummary } from '@/api/chats';
import { describeLoadError } from '@/lib/network';

export const chatsQueryKey = ['chats'] as const;

export type ChatsState = {
  chats: ChatSummary[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => void;
};

export function useChats(): ChatsState {
  const queryClient = useQueryClient();
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: chatsQueryKey,
    queryFn: listChats,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
  }, [queryClient]);

  return {
    chats: data ?? [],
    isLoading: isPending,
    isRefreshing: isFetching && !isPending,
    error: describeLoadError(error, 'Не удалось загрузить чаты'),
    refresh,
  };
}
