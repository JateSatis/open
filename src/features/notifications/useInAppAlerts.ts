import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { subscribeToUserEvents } from '@/api/chats';
import { chatQueryKey } from '@/features/chats/useChat';
import { chatsQueryKey } from '@/features/chats/useChats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { invitesQueryKey } from '@/features/chats/useInvites';
import { myInviteQueryKey } from '@/features/chats/useMyInvite';
import {
  dismissAlert,
  showAlert,
  useInAppAlert,
  type InAppAlert,
} from '@/features/notifications/alertsStore';
import { useActiveChatId } from '@/store/activeChat';

export type { InAppAlert } from '@/features/notifications/alertsStore';

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
  const alert = useInAppAlert((state) => state.alert);

  // Карточка прежнего пользователя не должна пережить выход.
  useEffect(() => dismissAlert(), [currentUserId]);

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

        showAlert({ kind: 'message', ...incoming });
      },
      onInvite: (invite) => {
        void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
        void queryClient.invalidateQueries({ queryKey: myInviteQueryKey(invite.chatId) });

        if (invite.chatId === activeChatId) return;

        showAlert({ kind: 'invite', ...invite });
      },
      onInviteChanged: (chatId) => {
        // Ответ с другого моего устройства или новое сообщение в чате, куда
        // меня зовут: карточка заявки и сам чат должны это отразить.
        void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
        void queryClient.invalidateQueries({ queryKey: myInviteQueryKey(chatId) });
        refreshChat(chatId);
      },
      onMemberJoined: refreshChat,
      // Превью откатилось — например, последнее сообщение удалили.
      onChatChanged: refreshChat,
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

  return { alert, dismiss: dismissAlert };
}
