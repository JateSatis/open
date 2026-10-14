import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { ChatGoneError } from '@/api/chatGone';
import { getChat, type ChatSummary } from '@/api/chats';
import { loadStateOf } from '@/lib/loadState';

const CHAT_STALE_MS = 10_000;

export function chatQueryKey(chatId: string) {
  return ['chat', chatId] as const;
}

export type ChatState = {
  chat: ChatSummary | null;
  isLoading: boolean;
  /** Чата нет, а все попытки его получить не удались — показать нечего. */
  failed: boolean;
  /**
   * Чат удалён (личный диалог удаляют для всех). Прежние данные из кеша
   * уже не правда: писать в него и показывать его нельзя.
   */
  gone: boolean;
};

/**
 * Повтор как у всего приложения (`QueryClient`), кроме удалённого чата: он
 * от повтора не вернётся.
 */
function retryUnlessGone(queryClient: QueryClient) {
  const fallback = queryClient.getDefaultOptions().queries?.retry ?? 3;

  return (failures: number, error: Error) => {
    if (error instanceof ChatGoneError) return false;
    if (typeof fallback === 'function') return fallback(failures, error);
    if (typeof fallback === 'number') return failures < fallback;

    return fallback;
  };
}

export function useChat(chatId: string): ChatState {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: chatQueryKey(chatId),
    queryFn: () => getChat(chatId),
    // Маршрут чата узнаёт вид чата раньше переписки (не канал ли это), и
    // переписка, смонтированная следом, не должна тут же спрашивать ещё раз.
    // Изменения состава приходят через Realtime и сбрасывают кеш сами.
    staleTime: CHAT_STALE_MS,
    retry: retryUnlessGone(queryClient),
  });
  const state = loadStateOf(query);
  const gone = query.error instanceof ChatGoneError;

  return {
    chat: gone ? null : (query.data ?? null),
    gone,
    // Без связи запрос стоит на паузе. Показывать в этот момент крутилку —
    // значит врать, что данные вот-вот придут: они не придут, пока сети нет.
    isLoading: state === 'loading',
    failed: !gone && state === 'failed',
  };
}
