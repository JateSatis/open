import { useInfiniteQuery, useQuery, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard } from 'react-native';

import { useDebounced } from '@/lib/useDebounced';

/** Пауза после последней буквы: список не прыгает на каждую букву. */
export const MATCH_SEARCH_DEBOUNCE_MS = 400;

/** Совпадение — запись списка, к которой можно прыгнуть. */
export type MatchHit = { id: string; seq: number };

export type MatchPage<Hit, Cursor> = { items: Hit[]; nextCursor: Cursor | null };

export type MatchSearch<Hit extends MatchHit = MatchHit> = {
  /** Запрос, по которому пришла выдача (после паузы), — даже когда поиск неактивен. */
  searched: string;
  hits: Hit[];
  /** Номер текущего совпадения, с нуля; свежие — первые. */
  index: number;
  /** Всего совпадений; `null` — ещё считается. */
  total: number | null;
  isSearching: boolean;
  failed: boolean;
  hasMore: boolean;
  loadMore: () => void;
  /** Стрелка вверх — к более старому совпадению. */
  older: () => void;
  /** Стрелка вниз — к более новому. */
  newer: () => void;
  /** Тап по строке списка. */
  select: (index: number) => void;
  /** Следующий поиск — снова с самого свежего совпадения. */
  reset: () => void;
};

export type MatchSearchSource<Hit extends MatchHit, Cursor> = {
  /** Что набрано в поле. */
  query: string;
  /** Совпадения ищутся и список прыгает к ним. */
  active: boolean;
  /** Ключ выдачи без запроса: чат, фильтры. */
  scope: QueryKey;
  fetchPage: (
    query: string,
    cursor: Cursor | null,
    signal: AbortSignal,
  ) => Promise<MatchPage<Hit, Cursor>>;
  count: (query: string, signal: AbortSignal) => Promise<number>;
  /** Прыжок списка к совпадению: догрузить место, прокрутить, подсветить. */
  jump: (hit: Hit) => Promise<boolean>;
};

/**
 * Поиск по одному списку, как в Telegram: по мере ввода список прыгает к
 * самому свежему совпадению, стрелки листают совпадения с прыжком и
 * подсветкой. Совпадения — с сервера, страницами; до далёкого список
 * догружает историю сам (`jump`). Общий для переписки и «Сохранённых».
 */
export function useMatchSearch<Hit extends MatchHit, Cursor>({
  query,
  active,
  scope,
  fetchPage,
  count: countHits,
  jump,
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

  // Номер совпадения — для этой выдачи: новый запрос (или та же строка после
  // закрытия поиска) начинается снова с самого свежего совпадения, туда же
  // прыгает и список.
  const first = hits[0];
  const firstId = first?.id;
  const [position, setPosition] = useState<{ query: string; firstId?: string; index: number }>({
    query: '',
    index: 0,
  });
  const index =
    position.query === debounced && position.firstId === firstId ? position.index : 0;

  const goTo = useCallback(
    (hit: Hit | undefined, at: number) => {
      if (!hit) return;

      setPosition({ query: debounced, firstId, index: at });
      void jump(hit);
    },
    [debounced, firstId, jump],
  );

  // Пришла выдача по новому запросу — список у самого свежего совпадения.
  useEffect(() => {
    if (!first) return;

    void jump(first);
    // Только по новому запросу и его первому совпадению.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, firstId]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = results;

  const older = useCallback(() => {
    Keyboard.dismiss();
    const next = index + 1;

    if (next < hits.length) {
      goTo(hits[next], next);
      return;
    }

    if (!hasNextPage || isFetchingNextPage) return;

    void fetchNextPage().then((page) => {
      const more = page.data?.pages.flatMap((item) => item.items) ?? [];

      goTo(more[next], next);
    });
  }, [fetchNextPage, goTo, hasNextPage, hits, index, isFetchingNextPage]);

  const newer = useCallback(() => {
    Keyboard.dismiss();

    if (index > 0) goTo(hits[index - 1], index - 1);
  }, [goTo, hits, index]);

  const select = useCallback(
    (at: number) => {
      Keyboard.dismiss();
      goTo(hits[at], at);
    },
    [goTo, hits],
  );

  const reset = useCallback(() => setPosition({ query: '', index: 0 }), []);

  return {
    searched: debounced,
    hits,
    index,
    total: count.data ?? (results.data && !hasNextPage ? hits.length : null),
    isSearching: enabled && (results.isFetching || debounced !== query.trim()),
    failed: results.isError,
    hasMore: Boolean(hasNextPage),
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    older,
    newer,
    select,
    reset,
  };
}
