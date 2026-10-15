import { useCallback, useMemo } from 'react';

import type { Pop } from '@/api/pops';
import type { SearchPop } from '@/api/search';
import type { PopFeed } from '@/features/pops/PopViewer/popFeed';
import { uniquePops, useSearchPopsQuery } from '@/features/search/useFeedSearch';

/**
 * Лента просмотра по выдаче поиска «Ленты»: та же запись кеша, что у сетки,
 * поэтому догруженное в просмотре видно сетке после «назад», а реакции и
 * счётчики — одни на двоих. Листается только вперёд: выше выбранного — то,
 * что сетка уже показала.
 */
export function useSearchPopFeed(query: string): PopFeed {
  const result = useSearchPopsQuery(query);
  const pops = useMemo(() => uniquePops(result.data?.pages), [result.data]);
  // Имя и аватарка канала приходят с попом: шапка не ждёт загрузки канала.
  const channelOf = useCallback((pop: Pop) => {
    const found = pop as Partial<SearchPop>;

    return found.channelTitle !== undefined
      ? { title: found.channelTitle, avatarUrl: found.channelAvatarUrl ?? null }
      : null;
  }, []);

  return {
    pops,
    isPending: result.isPending,
    isFetching: result.isFetching,
    error: result.error,
    hasNextPage: result.hasNextPage,
    hasPreviousPage: false,
    isFetchingNextPage: result.isFetchingNextPage,
    isFetchingPreviousPage: false,
    fetchNextPage: result.fetchNextPage,
    fetchPreviousPage: () => undefined,
    channelOf,
  };
}
