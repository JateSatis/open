import { useInfiniteQuery, useQuery, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useDebounced } from '@/lib/useDebounced';

/** Пауза после последней буквы: список не прыгает на каждую букву. */
export const MATCH_SEARCH_DEBOUNCE_MS = 400;

/** Совпадение — найденная запись. */
export type MatchHit = { id: string; seq: number };

export type MatchPage<Hit, Cursor> = { items: Hit[]; nextCursor: Cursor | null };

export type MatchSearch<Hit extends MatchHit = MatchHit> = {
  /** Запрос, по которому пришла выдача (после паузы), — даже когда поиск неактивен. */
  searched: string;
  hits: Hit[];
  /** Всего совпадений; `null` — ещё считается. */
  total: number | null;
  isSearching: boolean;
  failed: boolean;
  hasMore: boolean;
  loadMore: () => void;
};

export type MatchSearchSource<Hit extends MatchHit, Cursor> = {
  /** Что набрано в поле. */
  query: string;
  /** Поиск активен. */
  active: boolean;
  /** Ключ выдачи без запроса: чат, фильтры. */
  scope: QueryKey;
  fetchPage: (
    query: string,
    cursor: Cursor | null,
    signal: AbortSignal,
  ) => Promise<MatchPage<Hit, Cursor>>;
  count: (query: string, signal: AbortSignal) => Promise<number>;
};

/** Поиск по переписке и сохранённым: совпадения с сервера, страницами. */
export function useMatchSearch<Hit extends MatchHit, Cursor>({
  query,
  active,
  scope,
  fetchPage,
  count: countHits,
}: MatchSearchSource<Hit, Cursor>): MatchSearch<Hit> {
  const debounced = useDebounced(query.trim(), MATCH_SEARCH_DEBOUNCE_MS);
  const enabled = active && debounced !== '';

  // Не под ключом списка: его перечитывание (прочтения, правки) не должно
  // перезапрашивать выдачу и сдвигать совпадения под стрелками. Выдача живёт,
  // пока открыт поиск, — новое совпадение найдётся при новом запросе.
  const results = useInfiniteQuery({
    queryKey: [...scope, 'hits', debounced],
    // Курсор — того типа, что отдаёт `getNextPageParam`: обобщённый тип
    // TanStack Query здесь сам не выводит.
    queryFn: ({ pageParam, signal }) => fetchPage(debounced, pageParam as Cursor | null, signal),
    initialPageParam: null as Cursor | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: Infinity,
  });
  const count = useQuery({
    queryKey: [...scope, 'count', debounced],
    queryFn: ({ signal }) => countHits(debounced, signal),
    enabled,
    staleTime: Infinity,
  });

  const hits = useMemo(
    () => (enabled ? (results.data?.pages.flatMap((page) => page.items) ?? []) : []),
    [enabled, results.data],
  );

  return {
    searched: debounced,
    hits,
    total: count.data ?? (results.data && !results.hasNextPage ? hits.length : null),
    isSearching: enabled && (results.isFetching || debounced !== query.trim()),
    failed: results.isError,
    hasMore: Boolean(results.hasNextPage),
    loadMore: () => {
      if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
    },
  };
}
