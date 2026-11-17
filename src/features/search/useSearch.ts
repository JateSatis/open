import { useInfiniteQuery, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useFocusEffect } from '@/navigation';
import { useCallback, useMemo, useRef } from 'react';

import {
  searchEntities,
  searchMessages,
  type SearchEntity,
  type SearchMessage,
  type SearchMessagesCursor,
} from '@/api/search';
import { isSearchRateLimited, SEARCH_RATE_LIMIT_TEXT } from '@/api/searchLimits';
import { useChats } from '@/features/chats/useChats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import { localChatMatches } from '@/features/search/localChatMatches';
import { parseSearchQuery, type ParsedQuery } from '@/features/search/searchText';
import { describeLoadError } from '@/lib/network';
import { useDebounced } from '@/lib/useDebounced';

/**
 * Пауза после последней буквы перед запросом к серверу. Короткая: локальный
 * прогон по своим чатам виден сразу, а сервер не получает запрос на каждую
 * букву быстрого набора.
 */
export const SEARCH_DEBOUNCE_MS = 150;

/** Ответ сервера живёт полминуты: стёр букву и вернул — выдача из кеша, без запроса. */
export const SEARCH_STALE_MS = 30_000;

export const searchQueryKey = ['search'] as const;

/**
 * Прежняя выдача на время загрузки — только если человек допечатывает или
 * стирает тот же запрос. Ответ на другой, давний запрос (поле очистили и
 * набрали новое) обманул бы: лучше крутилка. React Query отдаёт сюда
 * последний запрос с данными, а не предыдущий ключ, — поэтому сравнение по
 * тексту, а не «был ли пустой запрос между ними». Текст запроса — третий
 * элемент ключа, у всех запросов поиска.
 */
export function whileTyping(current: string) {
  return <T>(previous: T | undefined, previousQuery?: { queryKey: QueryKey }): T | undefined => {
    const was = previousQuery?.queryKey[2];

    if (current === '' || typeof was !== 'string' || was === '') return undefined;

    return current.startsWith(was) || was.startsWith(current) ? previous : undefined;
  };
}

export type SearchResults = {
  parsed: ParsedQuery;
  mine: SearchEntity[];
  global: SearchEntity[];
  messages: SearchMessage[];
  hasMoreMessages: boolean;
  loadMoreMessages: () => void;
  /** Сервер ещё отвечает на текущий запрос — выдача может уточниться. */
  isSearching: boolean;
  /** Человеческое объяснение, почему выдача неполная; null — всё в порядке. */
  notice: string | null;
};

/**
 * Выдача поиска в «Чатах» для `query`.
 *
 * Устаревший ответ свежий не затирает: у каждого запроса свой ключ кеша, на
 * экран идут данные ключа текущего запроса, а пока их нет — прежние
 * (`whileTyping`), без мигания пустотой. Запрос, ключ которого уже не
 * нужен, отменяется сигналом.
 *
 * Блок «Чаты» до ответа сервера на текущий запрос — локальный прогон по
 * кешу списка «Чатов». Без сети он и остаётся, с пояснением.
 */
export function useSearch(query: string): SearchResults {
  const trimmed = query.trim();
  const parsed = useMemo(() => parseSearchQuery(trimmed), [trimmed]);
  const debounced = useDebounced(trimmed, SEARCH_DEBOUNCE_MS);
  const enabled = debounced !== '' && parseSearchQuery(debounced).text !== '';
  const connection = useConnectionStatus();
  const currentUserId = useCurrentUserId();
  const { chats } = useChats();
  const queryClient = useQueryClient();
  const focusedBefore = useRef(false);

  // Вернулись из открытого чата или канала: там могли подписаться или начать
  // диалог — выдача того же запроса перечитывается, а не ждёт конца срока.
  useFocusEffect(
    useCallback(() => {
      if (!focusedBefore.current) {
        focusedBefore.current = true;
        return;
      }

      void queryClient.invalidateQueries({ queryKey: searchQueryKey });
    }, [queryClient]),
  );

  const entities = useQuery({
    queryKey: [...searchQueryKey, 'entities', debounced],
    queryFn: ({ signal }) => searchEntities(debounced, signal),
    enabled,
    placeholderData: whileTyping(debounced),
    staleTime: SEARCH_STALE_MS,
  });

  const messages = useInfiniteQuery({
    queryKey: [...searchQueryKey, 'messages', debounced],
    queryFn: ({ pageParam, signal }) => searchMessages(debounced, pageParam, signal),
    initialPageParam: null as SearchMessagesCursor | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled,
    placeholderData: whileTyping(debounced),
    staleTime: SEARCH_STALE_MS,
  });

  const local = useMemo(
    () => localChatMatches(chats, parsed, currentUserId),
    [chats, currentUserId, parsed],
  );

  const offline =
    connection === 'offline' ||
    entities.fetchStatus === 'paused' ||
    messages.fetchStatus === 'paused';
  // Сбой догрузки следующей страницы сообщений не стирает уже показанное.
  const failed = entities.isError || (messages.isError && messages.data === undefined);
  // Ответ сервера — про текущий запрос, а не прежний, показанный на время загрузки.
  const fresh = debounced === trimmed && entities.data !== undefined && !entities.isPlaceholderData;
  const serverEntities = failed || offline || parsed.text === '' ? [] : (entities.data ?? []);
  const messageItems = useMemo(
    () =>
      failed || offline || parsed.text === ''
        ? []
        : (messages.data?.pages.flatMap((page) => page.items) ?? []),
    [failed, messages.data, offline, parsed.text],
  );

  const notice = offline
    ? 'Нет связи — ищем только по вашим чатам.'
    : failed && isSearchRateLimited(entities.error)
      ? SEARCH_RATE_LIMIT_TEXT
      : failed
        ? (describeLoadError(
            entities.error ?? messages.error,
            'Не удалось выполнить поиск. Попробуйте ещё раз.',
          ) ?? 'Нет связи — ищем только по вашим чатам.')
        : null;

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = messages;

  return {
    parsed,
    mine:
      fresh && !failed && !offline
        ? serverEntities.filter((entity) => entity.section === 'mine')
        : local,
    global: serverEntities.filter((entity) => entity.section === 'global'),
    messages: messageItems,
    hasMoreMessages: Boolean(hasNextPage) && !offline && !failed,
    loadMoreMessages: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    // Сообщения отвечают отдельно от сущностей: пока их нет, «Ничего не
    // нашлось» было бы неправдой.
    isSearching:
      parsed.text !== '' &&
      !offline &&
      !failed &&
      (!fresh || messages.isPending || messages.isPlaceholderData),
    notice: parsed.text === '' ? null : notice,
  };
}
