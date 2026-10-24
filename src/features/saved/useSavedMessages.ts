import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import type { ChatSummary } from '@/api/chats';
import { fetchSourceChats, listSavedMessages, type SavedMessage } from '@/api/saved';
import {
  savedMessagesQueryKey,
  savedSourceChatsQueryKey,
  savedSummaryQueryKey,
  savedTagsQueryKey,
} from '@/features/saved/keys';

const NO_CHATS = new Map<string, ChatSummary>();

/**
 * Сохранённое новыми вперёд (список перевёрнут: новые внизу), страницами по
 * `seq`. Чаты-источники — живые, одним запросом на загруженное.
 */
export function useSavedMessages() {
  const queryClient = useQueryClient();

  // Вход на экран — и счётчик «Посмотреть позже» в «Чатах», и теги свежие:
  // сохраняли, может быть, с другого устройства.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: savedSummaryQueryKey });
    void queryClient.invalidateQueries({ queryKey: savedTagsQueryKey });
  }, [queryClient]);

  const query = useInfiniteQuery({
    queryKey: savedMessagesQueryKey,
    queryFn: ({ pageParam }) => listSavedMessages(pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.nextCursor,
    // Синхронизации между устройствами нет: вход на экран перечитывает.
    refetchOnMount: 'always',
  });

  const items: SavedMessage[] = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const chatIds = useMemo(
    () => [...new Set(items.flatMap((item) => (item.sourceChatId ? [item.sourceChatId] : [])))],
    [items],
  );
  const chats = useQuery({
    queryKey: savedSourceChatsQueryKey(chatIds),
    queryFn: () => fetchSourceChats(chatIds),
    enabled: chatIds.length > 0,
    placeholderData: (previous) => previous,
  });

  return {
    items,
    chats: chats.data ?? NO_CHATS,
    isLoading: query.isLoading,
    failed: query.isError && items.length === 0,
    reload: () => void query.refetch(),
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
}
