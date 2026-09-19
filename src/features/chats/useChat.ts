import { useQuery } from '@tanstack/react-query';

import { getChat, type ChatSummary } from '@/api/chats';

export function chatQueryKey(chatId: string) {
  return ['chat', chatId] as const;
}

export type ChatState = {
  chat: ChatSummary | null;
  isLoading: boolean;
  error: string | null;
};

export function useChat(chatId: string): ChatState {
  const { data, isPending, error } = useQuery({
    queryKey: chatQueryKey(chatId),
    queryFn: () => getChat(chatId),
  });

  return {
    chat: data ?? null,
    isLoading: isPending,
    error: error ? (error.message ?? 'Не удалось открыть чат') : null,
  };
}
