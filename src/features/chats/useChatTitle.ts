import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQuery } from '@tanstack/react-query';

import { getChat } from '@/api/chats';
import { chatTitle } from '@/features/chats/chatDisplay';
import { chatQueryKey } from '@/features/chats/useChat';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';

/**
 * Имя чата там, где сам чат не под рукой (панель комментариев): берётся из
 * того же кеша, что у экрана чата, и обычно уже лежит в нём. Пока не
 * известно — пустая строка.
 */
export function useChatTitle(chatId: string | undefined): string {
  const api = useRequestClient();
  const currentUserId = useCurrentUserId();
  const { data } = useQuery({
    queryKey: chatQueryKey(chatId ?? ''),
    queryFn: () => getChat(chatId!, api),
    enabled: chatId !== undefined,
    staleTime: Infinity,
  });

  return data ? chatTitle(data, currentUserId) : '';
}
