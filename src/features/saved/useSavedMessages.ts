import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import {
  listSavedMessages,
  type SavedFilterInput,
  type SavedMessage,
  type SavedPageParam,
} from '@/api/saved';
import {
  savedMessagesKey,
  savedMessagesQueryKey,
  savedSummaryQueryKey,
  savedTagsQueryKey,
} from '@/features/saved/keys';
import { useSavedSourceChats } from '@/features/saved/useSavedSourceChats';

type PageParam = SavedPageParam;

type Filter = { input: SavedFilterInput | null; key: string | null };

/**
 * Сохранённое новыми вперёд (список перевёрнут: новые внизу), страницами по
 * `seq`, под фильтром — только подходящее. Чаты-источники — живые, одним
 * запросом на загруженное.
 */
export function useSavedMessages({ input, key }: Filter) {
  const api = useRequestClient();
  const queryClient = useQueryClient();
  const queryKey = savedMessagesKey(key);

  // Вход на экран — и счётчик «Посмотреть позже» в «Чатах», и теги свежие:
  // сохраняли, может быть, с другого устройства.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: savedSummaryQueryKey });
    void queryClient.invalidateQueries({ queryKey: savedTagsQueryKey });
  }, [queryClient]);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }: { pageParam: PageParam }) => listSavedMessages(pageParam, undefined, input, undefined, api),
    initialPageParam: { before: null } as PageParam,
    getNextPageParam: (page): PageParam | null =>
      page.nextCursor !== null ? { before: page.nextCursor } : null,
    // Синхронизации между устройствами нет: вход на экран перечитывает.
    refetchOnMount: 'always',
  });

  useEffect(
    () => () => {
      queryClient.removeQueries({
        queryKey: savedMessagesQueryKey,
        predicate: (cached) => cached.queryKey.length > savedMessagesQueryKey.length,
      });
    },
    [queryClient],
  );

  const items: SavedMessage[] = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const chats = useSavedSourceChats(items);

  const { hasNextPage, isFetchingNextPage } = query;
  const { fetchNextPage } = query;

  return {
    items,
    chats,
    isLoading: query.isLoading,
    failed: query.isError && items.length === 0,
    reload: () => void query.refetch(),
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    loadMore: useCallback(() => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]),
  };
}
