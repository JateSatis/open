import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import {
  listWatchLater,
  type SavedFilterInput,
  type SavedMessage,
  type WatchLaterCursor,
} from '@/api/saved';
import { savedWatchLaterKey, savedWatchLaterQueryKey } from '@/features/saved/keys';
import { watchLaterOrder } from '@/features/saved/savedCache';
import { useSavedSourceChats } from '@/features/saved/useSavedSourceChats';

type Filter = { input: SavedFilterInput | null; key: string | null };

/**
 * «Посмотреть позже» страницами: активные новыми вперёд, выполненные ниже;
 * под фильтром и поиском — только подходящие. Загруженное сортируется
 * заново — отметка в кеше переставляет строку сразу, не дожидаясь
 * перечитывания.
 */
export function useWatchLater(enabled: boolean, { input, key }: Filter) {
  const api = useRequestClient();
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: savedWatchLaterKey(key),
    queryFn: ({ pageParam }) => listWatchLater(pageParam, input, api),
    initialPageParam: null as WatchLaterCursor | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled,
    refetchOnMount: 'always',
  });

  // Списки под фильтрами и поиском с экраном не живут.
  useEffect(
    () => () =>
      queryClient.removeQueries({
        queryKey: savedWatchLaterQueryKey,
        predicate: (cached) => cached.queryKey.length > savedWatchLaterQueryKey.length,
      }),
    [queryClient],
  );

  // Запись, вставленная в кеш до своей страницы («Вернуть», отметка на
  // «Все»), сервер отдаст ещё раз — в списке она одна.
  const items: SavedMessage[] = useMemo(() => {
    const seen = new Set<string>();

    return (query.data?.pages.flatMap((page) => page.items) ?? [])
      .filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)))
      .sort(watchLaterOrder);
  }, [query.data]);
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
