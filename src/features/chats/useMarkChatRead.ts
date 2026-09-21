import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { markChatRead } from '@/api/chats';
import { chatQueryKey } from '@/features/chats/useChat';
import { chatsQueryKey } from '@/features/chats/useChats';

/**
 * Пока чат открыт, всё в нём считается прочитанным. Отметка переставляется при
 * входе и на каждое новое сообщение — `newestMessageId` и есть тот сигнал,
 * который отличает «пришло новое» от обычной перерисовки.
 */
export function useMarkChatRead(chatId: string, newestMessageId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!newestMessageId) return;

    let active = true;

    markChatRead(chatId)
      .then(() => {
        if (!active) return;

        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
      })
      .catch(() => {
        // Неудачная отметка прочтения — не повод показывать ошибку поверх
        // переписки: следующее сообщение или повторный вход поправят её.
      });

    return () => {
      active = false;
    };
  }, [chatId, newestMessageId, queryClient]);
}
