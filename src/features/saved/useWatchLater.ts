import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { listWatchLater, type SavedMessage, type WatchLaterCursor } from '@/api/saved';
import { savedWatchLaterQueryKey } from '@/features/saved/keys';
import { watchLaterOrder } from '@/features/saved/savedCache';
import { useSavedSourceChats } from '@/features/saved/useSavedSourceChats';

/**
 * «Посмотреть позже» страницами: активные новыми вперёд, выполненные ниже.
 * Загруженное сортируется заново — отметка в кеше переставляет строку сразу,
 * не дожидаясь перечитывания.
 */
export function useWatchLater(enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: savedWatchLaterQueryKey,
    queryFn: ({ pageParam }) => listWatchLater(pageParam),
    initialPageParam: null as WatchLaterCursor | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled,
    refetchOnMount: 'always',
  });

  const items: SavedMessage[] = useMemo(
    () => (query.data?.pages.flatMap((page) => page.items) ?? []).sort(watchLaterOrder),
    [query.data],
  );
  const chats = useSavedSourceChats(items);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  return {
    items,
    chats,
    isLoading: query.isLoading,
    failed: query.isError && items.length === 0,
    reload: () => void query.refetch(),
    isLoadingMore: isFetchingNextPage,
    loadMore: useCallback(() => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]),
  };
}
