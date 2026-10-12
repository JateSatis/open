import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { listMessages } from '@/api/chats';
import {
  mergeMessages,
  messagesQueryKey,
  readHistory,
  updateHistory,
  type ChatHistory,
} from '@/features/chats/messages/historyCache';
import { loadHistory } from '@/features/chats/messages/sync';
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
  /** Следующая страница назад. Параллельный вызов получает ту же догрузку, а не вторую. */
  loadMore: () => Promise<void>;
  /**
   * Догружает страницы назад, пока в истории не окажется сообщение с этим
   * временем, — по одной странице, «загрузить весь чат» не существует.
   * Отвечает, дошли ли до него.
   */
  loadUntil: (createdAt: string) => Promise<boolean>;
};

function reached(history: ChatHistory | undefined, createdAt: string): boolean {
  const oldest = history?.items[history.items.length - 1];

  return oldest !== undefined && oldest.createdAt <= createdAt;
}

/**
 * История переписки в кеше запросов. Между запросами свежей её держит
 * Realtime (см. `useChatChannel`).
 */
export function useChatHistory(chatId: string): ChatHistoryState {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: messagesQueryKey(chatId),
    // Повторный запрос — дочитывание, а не перезагрузка (см. `loadHistory`):
    // поэтому история спокойно перезапрашивается при каждом входе в чат и
    // после обрыва связи.
    queryFn: () => loadHistory(queryClient, chatId),
    // Возвращение связи и так перезапрашивает всё через `useConnectionWatch`.
    refetchOnReconnect: false,
  });
  const { data } = query;
  const state = loadStateOf(query);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const loadingMoreRef = useRef<Promise<void> | null>(null);

  const loadMore = useCallback((): Promise<void> => {
    if (loadingMoreRef.current) return loadingMoreRef.current;

    const cursor = readHistory(queryClient, chatId)?.nextCursor;

    if (!cursor) return Promise.resolve();

    setIsLoadingMore(true);

    const loading = listMessages(chatId, { cursor })
      .then((page) => {
        updateHistory(queryClient, chatId, (history) => ({
          ...mergeMessages(history, page.items, 'older'),
          nextCursor: page.nextCursor,
        }));
        setMoreError(null);
      })
      .catch((cause: unknown) => {
        setMoreError(describeLoadError(cause, 'Не удалось загрузить историю'));
      })
      .finally(() => {
        loadingMoreRef.current = null;
        setIsLoadingMore(false);
      });

    loadingMoreRef.current = loading;

    return loading;
  }, [chatId, queryClient]);

  const loadUntil = useCallback(
    async (createdAt: string): Promise<boolean> => {
      for (;;) {
        const history = readHistory(queryClient, chatId);

        if (!history) return false;
        if (reached(history, createdAt)) return true;
        if (!history.nextCursor) return false;

        await loadMore();

        // Страница не пришла (нет связи, сбой) — стоять на месте в цикле незачем.
        if (readHistory(queryClient, chatId)?.nextCursor === history.nextCursor) return false;
      }
    },
    [chatId, loadMore, queryClient],
  );

  return {
    items: data?.items ?? NO_MESSAGES,
    // Пустая история до первого ответа — не «сообщений пока нет», а «ещё не знаем».
    isLoading: state === 'loading' || state === 'paused',
    failed: state === 'failed',
    isLoadingMore,
    hasMore: Boolean(data?.nextCursor),
    // Не вышло дочитать поверх уже загруженного — не повод для плашки: следующее
    // событие или вход в чат дочитают снова. Не вышло загрузить вовсе — это
    // `failed`, экран сбоя, а не плашка.
    error: moreError,
    loadMore,
    loadUntil,
  };
}
