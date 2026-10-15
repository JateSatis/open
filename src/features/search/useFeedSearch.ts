import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  nextSearchPopsCursor,
  searchChannels,
  searchPops,
  type SearchChannel,
  type SearchPop,
  type SearchPopsCursor,
} from '@/api/search';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import { parseSearchQuery, type ParsedQuery } from '@/features/search/searchText';
import { SEARCH_DEBOUNCE_MS, SEARCH_STALE_MS, whileTyping } from '@/features/search/useSearch';
import { describeLoadError } from '@/lib/network';
import { useDebounced } from '@/lib/useDebounced';

/** Каналы выдачи «Ленты». Текст запроса — третий элемент ключа, как у всех запросов поиска. */
export const feedChannelsQueryKey = ['search', 'feed-channels'] as const;

/**
 * Попсы выдачи — под общим префиксом попсов `['pops']`: реакции, комментарии
 * и живые счётчики (`popsCache.ts`) ложатся сюда так же, как в сетку канала.
 * Эту же запись читает просмотр выдачи: догруженное в нём видно сетке.
 */
export const searchPopsQueryKey = (query: string) => ['pops', 'search', query] as const;

const OFFLINE_NOTICE = 'Нет связи — поиск недоступен.';

/**
 * Попсы выдачи страницами — общий запрос сетки и просмотра. Однажды
 * загруженная выдача сама не перечитывается — ни по сроку, ни при входе
 * просмотра, ни при возврате связи: страницы перечитались бы с новым
 * моментом отсчёта скора и переложились под пальцем. Счётчики в ней живут
 * событиями (`usePopCountersSync`), новая выдача — это новый запрос.
 */
export function useSearchPopsQuery(query: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: searchPopsQueryKey(query),
    queryFn: ({ pageParam, signal }) => searchPops(query, pageParam, signal),
    initialPageParam: null as SearchPopsCursor | null,
    getNextPageParam: nextSearchPopsCursor,
    enabled: enabled && query !== '',
    placeholderData: whileTyping(query),
    staleTime: Infinity,
    refetchOnReconnect: false,
  });
}

/**
 * Попсы выдачи без повторов: счётчики между страницами меняются, и поп мог
 * переехать на следующую страницу, уже показавшись на прошлой.
 */
export function uniquePops(pages: SearchPop[][] | undefined): SearchPop[] {
  const seen = new Set<string>();

  return (pages ?? []).flat().filter((pop) => {
    if (seen.has(pop.id)) return false;

    seen.add(pop.id);
    return true;
  });
}

export type FeedSearchResults = {
  parsed: ParsedQuery;
  /**
   * Запрос, чьи попсы сейчас на экране, — ключ для просмотра. Пока новый
   * запрос в пути, на экране ответ прежнего (`whileTyping`), и просмотр
   * должен открыть именно его.
   */
  shownQuery: string;
  channels: SearchChannel[];
  pops: SearchPop[];
  hasMorePops: boolean;
  loadMorePops: () => void;
  /** Сервер ещё отвечает на текущий запрос — выдача может уточниться. */
  isSearching: boolean;
  /** Человеческое объяснение, почему выдачи нет или она неполная; null — всё в порядке. */
  notice: string | null;
};

/**
 * Выдача поиска в «Ленте» для `query`: каналы и попсы. Поведение — как у
 * `useSearch` «Чатов»: пауза после буквы, свой ключ кеша у каждого запроса,
 * пока ответа на новый нет — прежняя выдача того же набора (`whileTyping`),
 * устаревший запрос отменяется сигналом. Без сети показанное не стирается:
 * на экране остаётся ответ, а над ним — пояснение.
 */
export function useFeedSearch(query: string): FeedSearchResults {
  const trimmed = query.trim();
  const parsed = useMemo(() => parseSearchQuery(trimmed), [trimmed]);
  const debounced = useDebounced(trimmed, SEARCH_DEBOUNCE_MS);
  const enabled = debounced !== '' && parseSearchQuery(debounced).text !== '';
  const connection = useConnectionStatus();
  const queryClient = useQueryClient();
  const focusedBefore = useRef(false);

  // Вернулись из канала: там могли подписаться — пометка подписки в строке
  // канала перечитывается. Попсы — нет: их счётчики живут событиями, а
  // перечитанная выдача переложила бы сетку под последним просмотренным.
  useFocusEffect(
    useCallback(() => {
      if (!focusedBefore.current) {
        focusedBefore.current = true;
        return;
      }

      void queryClient.invalidateQueries({ queryKey: feedChannelsQueryKey });
    }, [queryClient]),
  );

  const channels = useQuery({
    queryKey: [...feedChannelsQueryKey, debounced],
    queryFn: ({ signal }) => searchChannels(debounced, signal),
    enabled,
    placeholderData: whileTyping(debounced),
    staleTime: SEARCH_STALE_MS,
  });
  const pops = useSearchPopsQuery(debounced, enabled);

  const popItems = useMemo(() => uniquePops(pops.data?.pages), [pops.data]);
  const [shownQuery, setShownQuery] = useState(debounced);

  if (pops.data !== undefined && !pops.isPlaceholderData && shownQuery !== debounced) {
    setShownQuery(debounced);
  }

  const offline =
    connection === 'offline' || channels.fetchStatus === 'paused' || pops.fetchStatus === 'paused';
  const failed =
    (channels.isError && channels.data === undefined) || (pops.isError && pops.data === undefined);
  const settled =
    debounced === trimmed &&
    channels.data !== undefined &&
    !channels.isPlaceholderData &&
    pops.data !== undefined &&
    !pops.isPlaceholderData;

  const notice = offline
    ? OFFLINE_NOTICE
    : failed
      ? (describeLoadError(
          channels.error ?? pops.error,
          'Не удалось выполнить поиск. Попробуйте ещё раз.',
        ) ?? OFFLINE_NOTICE)
      : null;

  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = pops;
  const empty = parsed.text === '';
  // Не догрузилась следующая страница — показанное остаётся, крутилка внизу
  // не крутится вечно: пояснение, а повтор — новой прокруткой до конца.
  const pageNotice = isFetchNextPageError
    ? (describeLoadError(pops.error, 'Не удалось загрузить ещё. Пролистайте ещё раз.') ??
      OFFLINE_NOTICE)
    : null;

  return {
    parsed,
    shownQuery,
    channels: empty ? [] : (channels.data ?? []),
    pops: empty ? [] : popItems,
    hasMorePops: !empty && Boolean(hasNextPage) && !offline && !isFetchNextPageError,
    loadMorePops: () => {
      if (hasNextPage && !isFetchingNextPage && !offline) void fetchNextPage();
    },
    isSearching: !empty && !offline && !failed && !settled,
    notice: empty ? null : (notice ?? pageNotice),
  };
}
