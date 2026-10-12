import { useQuery } from '@tanstack/react-query';

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
};

export function useChat(chatId: string): ChatState {
  const query = useQuery({
    queryKey: chatQueryKey(chatId),
    queryFn: () => getChat(chatId),
    // Маршрут чата узнаёт вид чата раньше переписки (не канал ли это), и
    // переписка, смонтированная следом, не должна тут же спрашивать ещё раз.
    // Изменения состава приходят через Realtime и сбрасывают кеш сами.
    staleTime: CHAT_STALE_MS,
  });
  const state = loadStateOf(query);

  return {
    chat: query.data ?? null,
    // Без связи запрос стоит на паузе. Показывать в этот момент крутилку —
    // значит врать, что данные вот-вот придут: они не придут, пока сети нет.
    isLoading: state === 'loading',
    failed: state === 'failed',
  };
}
