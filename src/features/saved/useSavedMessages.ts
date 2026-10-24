import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import {
  listSavedAround,
  listSavedMessages,
  type SavedFilterInput,
  type SavedMessage,
  type SavedPage,
  type SavedPageParam,
} from '@/api/saved';
import {
  savedMessagesKey,
  savedMessagesQueryKey,
  savedSummaryQueryKey,
  savedTagsQueryKey,
} from '@/features/saved/keys';
import { useSavedSourceChats } from '@/features/saved/useSavedSourceChats';

/** С чего начинается страница: обычная или окно вокруг записи (переход к закрепу). */
type PageParam = SavedPageParam | { around: number };

type Filter = { input: SavedFilterInput | null; key: string | null };

/**
 * Сохранённое новыми вперёд (список перевёрнут: новые внизу), страницами по
 * `seq`, под фильтром — только подходящее. Обычно — от самых новых к старым;
 * после перехода к записи, которой не было среди загруженного, — окно
 * вокруг неё, догружаемое в обе стороны. Чаты-источники — живые, одним
 * запросом на загруженное.
 */
export function useSavedMessages({ input, key }: Filter) {
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
    queryFn: ({ pageParam }: { pageParam: PageParam }) =>
      'around' in pageParam
        ? listSavedAround(pageParam.around, input)
        : listSavedMessages(pageParam, undefined, input),
    initialPageParam: { before: null } as PageParam,
    getNextPageParam: (page): PageParam | null =>
      page.nextCursor !== null ? { before: page.nextCursor } : null,
    getPreviousPageParam: (page): PageParam | null =>
      page.prevCursor !== null ? { after: page.prevCursor } : null,
    // Синхронизации между устройствами нет: вход на экран перечитывает.
    refetchOnMount: 'always',
  });

  // Окно вокруг закрепа — только пока открыт экран: следующий вход снова с
  // самых новых, а не перечитыванием старого окна. Списки под фильтрами
  // уходят целиком: фильтры с экраном не живут.
  useEffect(
    () => () => {
      const data =
        queryClient.getQueryData<InfiniteData<SavedPage, PageParam>>(savedMessagesQueryKey);

      if (data?.pageParams.some((param) => 'around' in param || 'after' in param)) {
        queryClient.removeQueries({ queryKey: savedMessagesQueryKey, exact: true });
      }

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

  const { hasNextPage, hasPreviousPage, isFetchingNextPage, isFetchingPreviousPage } = query;
  const { fetchNextPage, fetchPreviousPage } = query;

  /**
   * Загружено ли место записи `seq`; нет — список заменяется окном вокруг
   * неё. Отвечает, есть ли запись теперь в списке (под фильтром — подходит ли).
   */
  const loadAround = useCallback(
    async (seq: number): Promise<boolean> => {
      const current = savedMessagesKey(key);
      const data = queryClient.getQueryData<InfiniteData<SavedPage, PageParam>>(current);
      const loaded = data?.pages.flatMap((page) => page.items) ?? [];

      if (loaded.some((item) => item.seq === seq)) return true;

      // Догрузка, начатая до перехода, иначе записала бы поверх окна старые страницы.
      await queryClient.cancelQueries({ queryKey: current, exact: true });

      const page = await listSavedAround(seq, input);

      if (!page.items.some((item) => item.seq === seq)) return false;

      queryClient.setQueryData<InfiniteData<SavedPage, PageParam>>(current, {
        pages: [page],
        pageParams: [{ around: seq }],
      });

      return true;
    },
    [input, key, queryClient],
  );

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
    /** Окно вокруг записи не доходит до самых новых — внизу догружаются они. */
    hasNewer: hasPreviousPage,
    loadNewer: useCallback(() => {
      if (hasPreviousPage && !isFetchingPreviousPage) void fetchPreviousPage();
    }, [fetchPreviousPage, hasPreviousPage, isFetchingPreviousPage]),
    loadAround,
  };
}
