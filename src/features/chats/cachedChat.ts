import type { QueryClient } from '@tanstack/react-query';

import type { ChatSummary } from '@/api/chats';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { chatQueryKey } from '@/features/chats/useChat';

/**
 * Чат из кеша, без запроса: из списка «Чаты», а если его ещё не грузили
 * (вход по ссылке или пушу сразу в чат) — из кеша самого чата. Для подписи
 * всплывашки и входящего звонка — им ждать сети некогда.
 */
export function cachedChat(queryClient: QueryClient, chatId: string): ChatSummary | undefined {
  return (
    queryClient
      .getQueryData<ChatSummary[]>(chatsQueryKey)
      ?.find((candidate) => candidate.id === chatId) ??
    queryClient.getQueryData<ChatSummary>(chatQueryKey(chatId))
  );
}
