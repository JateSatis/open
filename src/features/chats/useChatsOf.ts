import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { listChatsOf, type ChatSummary } from '@/api/chats';
import { describeLoadError } from '@/lib/network';

export function chatsOfQueryKey(userId: string) {
  return ['chats-of', userId] as const;
}

export type ChatsOfState = {
  chats: ChatSummary[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
};

/**
 * Чаты другого человека — как он видит свой список. Постранично: «загрузить
 * всё» для человека с сотнями чатов было бы дорого. Позже сюда добавятся
 * чаты, на которые он подписан.
 */
export function useChatsOf(userId: string): ChatsOfState {
  const { data, isPending, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: chatsOfQueryKey(userId),
      queryFn: ({ pageParam }) => listChatsOf(userId, pageParam),
      initialPageParam: 0,
      getNextPageParam: (last) => last.nextPage,
    });

  const chats = useMemo(() => {
    // Чат, сдвинувшийся между страницами, мог прийти дважды.
    const seen = new Set<string>();

    return (data?.pages ?? [])
      .flatMap((page) => page.items)
      .filter((chat) => (seen.has(chat.id) ? false : (seen.add(chat.id), true)));
  }, [data]);

  return {
    chats,
    isLoading: isPending,
    isLoadingMore: isFetchingNextPage,
    hasMore: Boolean(hasNextPage),
    error: data ? null : describeLoadError(error, 'Не удалось загрузить диалоги'),
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
  };
}
