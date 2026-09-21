import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { subscribeToIncomingMessages, type IncomingMessage } from '@/api/chats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { chatQueryKey } from '@/features/chats/useChat';
import { chatsQueryKey } from '@/features/chats/useChats';
import { useActiveChatId } from '@/store/activeChat';

export type MessageAlert = IncomingMessage;

export type IncomingMessageAlertsState = {
  alert: MessageAlert | null;
  dismiss: () => void;
};

/**
 * Входящие сообщения из всех чатов сразу. Канал персональный, поэтому работает
 * на любом экране, а не только внутри переписки: именно он и даёт уведомление.
 */
export function useIncomingMessageAlerts(): IncomingMessageAlertsState {
  const currentUserId = useCurrentUserId();
  const activeChatId = useActiveChatId();
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<MessageAlert | null>(null);

  useEffect(() => {
    if (!currentUserId) return;

    const unsubscribe = subscribeToIncomingMessages(
      currentUserId,
      (incoming) => {
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(incoming.chatId) });

        // Показывать карточку о чате, который человек прямо сейчас читает, —
        // значит перекрывать уведомлением то самое сообщение.
        if (incoming.chatId === activeChatId) return;

        setAlert(incoming);
      },
      () => {
        // Канал возвращается после обрыва: сообщения, пришедшие за это время,
        // мимо него прошли, и список чатов о них не знает.
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      },
    );

    return () => {
      unsubscribe();
    };
  }, [activeChatId, currentUserId, queryClient]);

  const dismiss = useCallback(() => setAlert(null), []);

  return { alert, dismiss };
}
