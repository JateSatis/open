import { useInfiniteQuery } from '@tanstack/react-query';

import { searchPeople, type PeopleCursor } from '@/api/groups';
import { useDebounced } from '@/lib/useDebounced';

/** Пауза после последней буквы перед запросом людей. */
const PEOPLE_DEBOUNCE_MS = 250;

/**
 * Люди для приглашения: поиск на сервере по имени и `@имени`, страницами по
 * алфавиту. Пока человек допечатывает, на экране — прежняя выдача.
 */
export function useInviteCandidates(query: string) {
  const debounced = useDebounced(query.trim(), PEOPLE_DEBOUNCE_MS);

  const result = useInfiniteQuery({
    queryKey: ['people', 'search', debounced],
    queryFn: ({ pageParam, signal }) => searchPeople(debounced, pageParam, signal),
    initialPageParam: null as PeopleCursor | null,
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: (previous) => previous,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = result;

  return {
    people: result.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: result.isPending,
    failed: result.isError && result.data === undefined,
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    retry: () => void refetch(),
  };
}
