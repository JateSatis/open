import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { subscribeToUserEvents, type IncomingInvite, type IncomingMessage } from '@/api/chats';
import { chatQueryKey } from '@/features/chats/useChat';
import { chatsQueryKey } from '@/features/chats/useChats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { invitesQueryKey } from '@/features/chats/useInvites';
import { myInviteQueryKey } from '@/features/chats/useMyInvite';
import { useActiveChatId } from '@/store/activeChat';

export type InAppAlert =
  ({ kind: 'message' } & IncomingMessage) | ({ kind: 'invite' } & IncomingInvite);

export type InAppAlertsState = {
  alert: InAppAlert | null;
  dismiss: () => void;
};

/**
 * Всё, что приходит лично мне: сообщения из всех чатов и заявки. Канал
 * персональный, поэтому работает на любом экране, а не только внутри
 * переписки: именно он и даёт уведомление и держит счётчик заявок свежим.
 */
export function useInAppAlerts(): InAppAlertsState {
  const currentUserId = useCurrentUserId();
  const activeChatId = useActiveChatId();
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<InAppAlert | null>(null);

  useEffect(() => {
    if (!currentUserId) return;

    const refreshChat = (chatId: string) => {
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
    };

    const unsubscribe = subscribeToUserEvents(currentUserId, {
      onMessage: (incoming) => {
        refreshChat(incoming.chatId);

        // Показывать карточку о чате, который человек прямо сейчас читает, —
        // значит перекрывать уведомлением то самое сообщение.
        if (incoming.chatId === activeChatId) return;

        setAlert({ kind: 'message', ...incoming });
      },
      onInvite: (invite) => {
        void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
        void queryClient.invalidateQueries({ queryKey: myInviteQueryKey(invite.chatId) });

        if (invite.chatId === activeChatId) return;

        setAlert({ kind: 'invite', ...invite });
      },
      onInviteChanged: (chatId) => {
        // Ответ с другого моего устройства или новое сообщение в чате, куда
        // меня зовут: карточка заявки и сам чат должны это отразить.
        void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
        void queryClient.invalidateQueries({ queryKey: myInviteQueryKey(chatId) });
        refreshChat(chatId);
      },
      onMemberJoined: refreshChat,
      onReconnected: () => {
        // Канал возвращается после обрыва: сообщения и заявки, пришедшие за
        // это время, мимо него прошли, и списки о них не знают.
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
        void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
      },
    });

    return () => {
      unsubscribe();
    };
  }, [activeChatId, currentUserId, queryClient]);

  const dismiss = useCallback(() => setAlert(null), []);

  return { alert, dismiss };
}
