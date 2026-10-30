import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import {
  mergeMessages,
  messagesQueryKey,
  readHistory,
  updateHistory,
  type ChatHistory,
  type HistoryView,
} from '@/features/chats/messages/historyCache';
import { listHistoryPage, loadHistory } from '@/features/chats/messages/sync';
import type { ChatMessage } from '@/features/chats/messages/types';
import { loadStateOf } from '@/lib/loadState';
import { describeLoadError } from '@/lib/network';

const NO_MESSAGES: ChatMessage[] = [];

export type ChatHistoryState = {
  /** Только подтверждённые сервером, самые новые первыми. */
  items: ChatMessage[];
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
   * края истории (`atEdge`) она и пробует сразу: список второй раз не зовёт
   * догрузку при той же длине содержимого.
   */
  resumeLoadMore: (atEdge: boolean) => void;
  /**
   * Догружает страницы назад, пока в истории не окажется сообщение с этим
   * номером, — по одной странице, «загрузить весь чат» не существует.
   * Отвечает, дошли ли до него.
   */
  loadUntil: (seq: number) => Promise<boolean>;
};

function reached(history: ChatHistory | undefined, seq: number): boolean {
  const oldest = history?.items[history.items.length - 1];

  return oldest !== undefined && oldest.seq <= seq;
}

/**
 * История переписки в кеше запросов. Между запросами свежей её держит
 * Realtime (см. `useChatChannel`).
 */
export function useChatHistory(
  chatId: string,
  view: HistoryView = 'all',
  enabled = true,
): ChatHistoryState {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: messagesQueryKey(chatId, view),
    // Повторный запрос — дочитывание, а не перезагрузка (см. `loadHistory`):
    // поэтому история спокойно перезапрашивается при каждом входе в чат и
    // после обрыва связи.
    queryFn: () => loadHistory(queryClient, chatId, view),
    enabled,
    // Возвращение связи и так перезапрашивает всё через `useConnectionWatch`.
    refetchOnReconnect: false,
  });
  const { data } = query;
  const state = loadStateOf(query);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const loadingMoreRef = useRef<Promise<void> | null>(null);
  const stalledRef = useRef(false);

  const fetchOlder = useCallback((): Promise<void> => {
    if (loadingMoreRef.current) return loadingMoreRef.current;

    const cursor = readHistory(queryClient, chatId, view)?.nextCursor ?? null;

    if (cursor === null) return Promise.resolve();

    setIsLoadingMore(true);

    const loading = listHistoryPage(chatId, view, cursor)
      .then((page) => {
        updateHistory(
          queryClient,
          chatId,
          (history) => ({
            ...mergeMessages(history, page.items, 'older'),
            nextCursor: page.nextCursor,
          }),
          view,
        );
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
  }, [chatId, queryClient, view]);

  const loadMore = useCallback(
    (): Promise<void> => (stalledRef.current ? Promise.resolve() : fetchOlder()),
    [fetchOlder],
  );

  const resumeLoadMore = useCallback(
    (atEdge: boolean) => {
      if (!stalledRef.current) return;

      stalledRef.current = false;
      if (atEdge) void fetchOlder();
    },
    [fetchOlder],
  );

  const loadUntil = useCallback(
    async (seq: number): Promise<boolean> => {
      for (;;) {
        const history = readHistory(queryClient, chatId, view);

        if (!history) return false;
        if (reached(history, seq)) return true;
        if (history.nextCursor === null) return false;

        // Переход к сообщению — явное действие человека: пробуем и после неудачи.
        await fetchOlder();

        // Страница не пришла (нет связи, сбой) — стоять на месте в цикле незачем.
        if (readHistory(queryClient, chatId, view)?.nextCursor === history.nextCursor) return false;
      }
    },
    [chatId, fetchOlder, queryClient, view],
  );

  return {
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
    loadUntil,
  };
}
