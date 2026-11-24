import { requestClient } from '@/api/requestClient';
import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  mergeMessages,
  messagesQueryKey,
  readHistory,
  updateHistory,
  type HistoryView,
} from '@/features/chats/messages/historyCache';
import { listHistoryPage, loadHistory } from '@/features/chats/messages/sync';
import type { ChatMessage } from '@/features/chats/messages/types';
import { loadStateOf } from '@/lib/loadState';
import { describeLoadError } from '@/lib/network';

import { loadPage, projection, refreshLocal } from './local/loader';
import { localHistory } from './local/database';
import { stillReader, useHistoryReader } from './local/reader';
import type { ReadingPlace } from './local/segments';

const NO_MESSAGES: ChatMessage[] = [];
const OLDER_PAGE_SIZE = 50;

export type ChatHistoryState = {
  /** Только подтверждённые сервером, самые новые первыми. */
  items: ChatMessage[];
  readingPlace?: ReadingPlace | null;
  loadNewer?: () => void;
  isLoading: boolean;
  /** Истории нет, а все попытки её загрузить не удались — показать нечего. */
  failed: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /**
   * Следующая страница назад. Параллельный вызов получает ту же догрузку, а не
   * вторую. После неудачи молчит до `resumeLoadMore`: список зовёт догрузку
   * сам, пока стоит у края, и без паузы повторял бы её по кругу.
   */
  loadMore: () => Promise<void>;
  /**
   * Человек снова листает — после неудачи догрузка снова разрешена. У самого
   * края истории (`atEdge`) пробует сразу, даже если ошибки не было: список
   * может не вызвать onEndReached по устаревшей позиции.
   */
  resumeLoadMore: (atEdge: boolean) => void;
};

/**
 * История переписки в кеше запросов. Между запросами свежей её держит
 * Realtime (см. `useChatChannel`).
 */
export function useChatHistory(
  chatId: string,
  view: HistoryView = 'all',
  enabled = true,
): ChatHistoryState {
  const api = useRequestClient();
  const queryClient = useQueryClient();
  const reader = useHistoryReader();
  const scope = useMemo(
    () => (reader && view === 'all' ? { reader, chat: chatId } : null),
    [reader, chatId, view],
  );
  const disk = useMemo(() => {
    if (!scope) return null;
    const db = localHistory();
    const place = db.place(scope);
    return { place, history: projection(scope, db.read(scope, place)) };
  }, [scope]);
  const query = useQuery({
    queryKey: messagesQueryKey(chatId, view),
    // Повторный запрос — дочитывание, а не перезагрузка (см. `loadHistory`):
    // поэтому история спокойно перезапрашивается при каждом входе в чат и
    // после обрыва связи.
    initialData: disk?.history,
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }) => {
      if (!scope) return loadHistory(queryClient, chatId, view, api);
      const active = () => !signal.aborted && api === requestClient() && stillReader(scope.reader);
      const db = localHistory();
      const previous = readHistory(queryClient, chatId);
      const stable = () => active() && readHistory(queryClient, chatId) === previous;
      try {
        await refreshLocal(scope, db.place(scope), stable, api);
      } catch (error) {
        // A sibling may already have committed a verified revocation.
        if (stable() && previous) {
          const verified = projection(scope, db.read(scope));
          if (verified) queryClient.setQueryData(messagesQueryKey(chatId), verified);
        }
        throw error;
      }
      if (!active()) throw new Error('History scope changed');
      if (!stable()) {
        // Realtime or navigation landed during the read. Recheck against its new generation.
        void queryClient.invalidateQueries({ queryKey: messagesQueryKey(chatId), exact: true });
        return readHistory(queryClient, chatId) ?? { items: [], nextCursor: null };
      }
      return projection(scope, db.read(scope)) ?? { items: [], nextCursor: null };
    },
    enabled,
    // После подтверждения сервера открытая история обновится вместе с другими экранами.
    refetchOnReconnect: false,
  });
  const { data } = query;
  const state = loadStateOf(query);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const loadingMoreRef = useRef<Promise<void> | null>(null);
  const stalledRef = useRef(false);

  const publishPage = useCallback(
    (previous: ReturnType<typeof readHistory>) => {
      if (!scope || api !== requestClient() || !stillReader(scope.reader)) return;
      if (previous !== readHistory(queryClient, chatId)) {
        void queryClient.invalidateQueries({ queryKey: messagesQueryKey(chatId), exact: true });
        return;
      }
      const fresh = projection(scope, localHistory().read(scope));
      if (fresh) queryClient.setQueryData(messagesQueryKey(chatId), fresh);
    },
    [api, chatId, queryClient, scope],
  );

  const fetchOlder = useCallback((): Promise<void> => {
    if (loadingMoreRef.current) return loadingMoreRef.current;

    const previous = readHistory(queryClient, chatId, view);
    const cursor = previous?.nextCursor ?? null;

    if (cursor === null) return Promise.resolve();

    setIsLoadingMore(true);

    const loading = (
      scope && typeof cursor !== 'number'
        ? loadPage(
            scope,
            { mode: 'before', cursor, limit: OLDER_PAGE_SIZE },
            () => api === requestClient() && stillReader(scope.reader),
            api,
          ).then(() => publishPage(previous))
        : listHistoryPage(chatId, view, cursor, api).then((page) => {
            updateHistory(
              queryClient,
              chatId,
              (history) => ({
                ...mergeMessages(history, page.items, 'older'),
                nextCursor: page.nextCursor,
              }),
              view,
            );
          })
    )
      .then(() => {
        setMoreError(null);
        stalledRef.current = false;
      })
      .catch((cause: unknown) => {
        stalledRef.current = true;
        setMoreError(describeLoadError(cause, 'Не удалось загрузить историю'));
      })
      .finally(() => {
        loadingMoreRef.current = null;
        setIsLoadingMore(false);
      });

    loadingMoreRef.current = loading;

    return loading;
  }, [api, chatId, queryClient, scope, view, publishPage]);

  const loadMore = useCallback(
    (): Promise<void> => (stalledRef.current ? Promise.resolve() : fetchOlder()),
    [fetchOlder],
  );

  const resumeLoadMore = useCallback(
    (atEdge: boolean) => {
      stalledRef.current = false;
      if (atEdge) void fetchOlder();
    },
    [fetchOlder],
  );

  const loadingNewer = useRef(false);
  const loadNewer = () => {
    if (!scope || !data?.afterCursor || loadingNewer.current) return;
    loadingNewer.current = true;
    void loadPage(
      scope,
      { mode: 'after', cursor: data.afterCursor, limit: 30 },
      () => api === requestClient() && stillReader(scope.reader),
      api,
    )
      .then(() => publishPage(data))
      .catch((cause: unknown) =>
        setMoreError(describeLoadError(cause, 'Не удалось загрузить историю')),
      )
      .finally(() => {
        loadingNewer.current = false;
      });
  };
  return {
    readingPlace: disk?.history ? disk.place : null,
    loadNewer: data?.afterCursor ? loadNewer : undefined,
    items: data?.items ?? NO_MESSAGES,
    // Пустая история до первого ответа — не «сообщений пока нет», а «ещё не знаем».
    isLoading: state === 'loading' || state === 'paused',
    failed: state === 'failed',
    isLoadingMore,
    hasMore: data?.nextCursor !== undefined && data.nextCursor !== null,
    // Не вышло дочитать поверх уже загруженного — не повод для плашки: следующее
    // событие или вход в чат дочитают снова. Не вышло загрузить вовсе — это
    // `failed`, экран сбоя, а не плашка.
    error: moreError,
    loadMore,
    resumeLoadMore,
  };
}
