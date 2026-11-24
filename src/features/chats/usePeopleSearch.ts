import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useInfiniteQuery } from '@tanstack/react-query';

import { searchPeople, type PeopleCursor } from '@/api/groups';
import { isSearchRateLimited } from '@/api/searchLimits';
import { useDebounced } from '@/lib/useDebounced';

/** Пауза после последней буквы перед запросом людей. */
const PEOPLE_DEBOUNCE_MS = 250;

/**
 * Люди для «Нового чата» и приглашения в группу, страницами по алфавиту.
 * Пустой запрос — знакомые: друзья и люди из моих чатов. Запрос — поиск на
 * сервере по имени и `@имени` с учётом настройки «Кто может найти меня в
 * поиске». Каталога всех пользователей нет. Пока человек допечатывает, на
 * экране — прежняя выдача.
 */
export function usePeopleSearch(query: string) {
  const api = useRequestClient();
  const debounced = useDebounced(query.trim(), PEOPLE_DEBOUNCE_MS);

  const result = useInfiniteQuery({
    queryKey: ['people', 'search', debounced],
    queryFn: ({ pageParam, signal }) => searchPeople(debounced, pageParam, signal, api),
    initialPageParam: null as PeopleCursor | null,
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: (previous) => previous,
    // Лимит частоты — не сбой связи: повтор сразу упрётся в него же.
    retry: (count, error) => !isSearchRateLimited(error) && count < 2,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = result;
  const failed = result.isError && result.data === undefined;

  return {
    people: result.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: result.isPending,
    failed,
    /** Слишком много запросов поиска подряд — сервер просит подождать. */
    rateLimited: result.isError && isSearchRateLimited(result.error),
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    retry: () => void refetch(),
  };
}
