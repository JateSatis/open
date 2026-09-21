import { useQuery } from '@tanstack/react-query';

import { getChat, type ChatSummary } from '@/api/chats';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import { describeLoadError } from '@/lib/network';

export function chatQueryKey(chatId: string) {
  return ['chat', chatId] as const;
}

export type ChatState = {
  chat: ChatSummary | null;
  isLoading: boolean;
  error: string | null;
};

export function useChat(chatId: string): ChatState {
  const connection = useConnectionStatus();
  const { data, isPending, fetchStatus, error } = useQuery({
    queryKey: chatQueryKey(chatId),
    queryFn: () => getChat(chatId),
  });

  return {
    chat: data ?? null,
    // Без связи запрос стоит на паузе. Показывать в этот момент крутилку —
    // значит врать, что данные вот-вот придут: они не придут, пока сети нет.
    isLoading: isPending && fetchStatus !== 'paused',
    error:
      data !== undefined || connection !== 'online'
        ? null
        : describeLoadError(error, 'Не удалось открыть чат'),
  };
}
