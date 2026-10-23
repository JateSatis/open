import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { subscribeToUserEvents } from '@/api/chats';
import { channelSubscriptionQueryKey } from '@/features/channels/keys';
import { chatQueryKey } from '@/features/chats/useChat';
import { chatsQueryKey } from '@/features/chats/useChats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { invitesQueryKey } from '@/features/chats/useInvites';
import { myInviteQueryKey } from '@/features/chats/useMyInvite';
import { friendKeys } from '@/features/friends/keys';
import { popsQueryKey } from '@/features/pops/keys';
import {
  dismissAlert,
  showAlert,
  useInAppAlert,
  type InAppAlert,
} from '@/features/notifications/alertsStore';
import { leaveCall } from '@/features/streams/callSession';
import { getCall } from '@/features/streams/callStore';
import { ring, resetRinging, stopRinging } from '@/features/streams/incomingCall';
import { liveStreamQueryKey } from '@/features/streams/streamKeys';
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
  useEffect(() => {
    dismissAlert();
    resetRinging();
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;

    const refreshChat = (chatId: string) => {
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
    };

    const unsubscribe = subscribeToUserEvents(currentUserId, {
      onMessage: (incoming) => {
        refreshChat(incoming.chatId);

        // Пост канала, который я читаю: счётчики разделов канала тоже устарели.
        if (incoming.channel) {
          void queryClient.invalidateQueries({
            queryKey: channelSubscriptionQueryKey(incoming.channel.id),
          });
        }

        // Показывать карточку о чате, который человек прямо сейчас читает, —
        // значит перекрывать уведомлением то самое сообщение. О звонке
        // сообщает сам входящий, а не карточка системного сообщения.
        // Выключенные уведомления канала гасят только карточку: канал в
        // списке всё равно поднимается.
        if (
          incoming.chatId === activeChatId ||
          incoming.messageKind === 'system' ||
          !incoming.notify
        ) {
          return;
        }

        showAlert({ kind: 'message', ...incoming });
      },
      onPop: (pop) => {
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
        void queryClient.invalidateQueries({
          queryKey: channelSubscriptionQueryKey(pop.channel.id),
        });
        void queryClient.invalidateQueries({ queryKey: popsQueryKey(pop.channel.id) });

        if (pop.chatId === activeChatId || !pop.notify) return;

        showAlert({ kind: 'pop', ...pop });
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
      onIncomingCall: (call) => {
        void queryClient.invalidateQueries({ queryKey: liveStreamQueryKey(call.chatId) });
        ring(call);
      },
      onStreamEnded: (streamId, chatId) => {
        stopRinging(streamId);
        void queryClient.invalidateQueries({ queryKey: liveStreamQueryKey(chatId) });
      },
      // Превью откатилось — например, последнее сообщение удалили.
      onChatChanged: refreshChat,
      onMembershipEnded: (chatId) => {
        refreshChat(chatId);

        // Ушёл из группы (может, с другого устройства) или удалили: говорить
        // в её звонке я больше не вправе.
        if (getCall()?.chatId === chatId) void leaveCall();
      },
      // Вкладка «Профиль» не размонтируется: без сигнала счётчик заявок на
      // строке «Друзья» не узнал бы о новой до перезапуска.
      onFriendsChanged: () => {
        void queryClient.invalidateQueries({ queryKey: friendKeys.all });
      },
      onReconnected: () => {
        // Канал возвращается после обрыва: сообщения и заявки, пришедшие за
        // это время, мимо него прошли, и списки о них не знают.
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
        void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
        void queryClient.invalidateQueries({ queryKey: friendKeys.all });
      },
    });

    return () => {
      unsubscribe();
    };
  }, [activeChatId, currentUserId, queryClient]);

  return { alert, dismiss: dismissAlert };
}
