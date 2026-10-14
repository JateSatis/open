import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard } from 'react-native';

import {
  countChatSearch,
  searchChatMessages,
  type ChatSearchCursor,
  type ChatSearchHit,
} from '@/api/chats';
import { useDebounced } from '@/lib/useDebounced';

/** Пауза после последней буквы: переписка не прыгает на каждую букву. */
const CHAT_SEARCH_DEBOUNCE_MS = 400;

/** Параметры адреса, которыми страница чата открывает переписку в поиске. */
export type ChatSearchParams = { search?: string; searchKey?: string };

export type ChatSearch = {
  /** Переписка в режиме поиска: поле вместо шапки, плашка вместо поля ввода. */
  active: boolean;
  query: string;
  setQuery: (value: string) => void;
  /** Запрос, по которому пришла выдача, — им подсвечивается совпадение в списке. */
  searched: string;
  hits: ChatSearchHit[];
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
  close: () => void;
};

/**
 * Поиск по одному чату, как в Telegram: по мере ввода переписка прыгает к
 * самому свежему совпадению, стрелки листают совпадения с прыжком и
 * подсветкой. Совпадения — с сервера, страницами; до далёкого переписка
 * догружает историю сама (`jump`).
 */
export function useChatSearch(
  chatId: string,
  jump: (rowKey: string, createdAt: string) => Promise<boolean>,
): ChatSearch {
  const params = useLocalSearchParams<ChatSearchParams>();
  const navigation = useNavigation();
  const active = params.search === '1';
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), CHAT_SEARCH_DEBOUNCE_MS);
  const enabled = active && debounced !== '';

  const results = useInfiniteQuery({
    queryKey: ['chat', chatId, 'search', debounced],
    queryFn: ({ pageParam, signal }) => searchChatMessages(chatId, debounced, pageParam, signal),
    initialPageParam: null as ChatSearchCursor | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
  const count = useQuery({
    queryKey: ['chat', chatId, 'search-count', debounced],
    queryFn: ({ signal }) => countChatSearch(chatId, debounced, signal),
    enabled,
  });

  const hits = useMemo(
    () => (enabled ? (results.data?.pages.flatMap((page) => page.items) ?? []) : []),
    [enabled, results.data],
  );

  // Новый запрос — снова с самого свежего совпадения.
  const [position, setPosition] = useState({ query: debounced, index: 0 });
  const index = position.query === debounced ? position.index : 0;
  const first = hits[0];

  const goTo = useCallback(
    (hit: ChatSearchHit | undefined, at: number) => {
      if (!hit) return;

      setPosition({ query: debounced, index: at });
      void jump(hit.id, hit.createdAt);
    },
    [debounced, jump],
  );

  // Пришла выдача по новому запросу — переписка у самого свежего совпадения.
  const firstId = first?.id;

  useEffect(() => {
    if (!first) return;

    void jump(first.id, first.createdAt);
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

  const close = useCallback(() => {
    Keyboard.dismiss();
    setQuery('');
    navigation.setParams({ search: undefined, searchKey: undefined } as never);
  }, [navigation]);

  return {
    active,
    query,
    setQuery,
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
    close,
  };
}
