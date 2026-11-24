import { requestClient } from '@/api/requestClient';
import type { QueryClient } from '@tanstack/react-query';

import { subscribeToUserEvents } from '@/api/chats';
import { channelSubscriptionQueryKey } from '@/features/channels/keys';
import { chatQueryKey } from '@/features/chats/useChat';
import { refreshRead } from '@/features/chats/messages/local/readQueries';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { confirmedAccountId, useSessionStore } from '@/features/auth/sessionState';
import { invitesQueryKey } from '@/features/chats/useInvites';
import { bindUserChannel } from '@/lib/queryClient';
import { myInviteQueryKey } from '@/features/chats/useMyInvite';
import { friendKeys } from '@/features/friends/keys';
import { profileKeys } from '@/features/profile/keys';
import { popsQueryKey } from '@/features/pops/keys';
import { dismissAlert, showAlert } from '@/features/notifications/alertsStore';
import { leaveCall } from '@/features/streams/callSession';
import { getCall } from '@/features/streams/callStore';
import { ring, resetRinging, stopRinging } from '@/features/streams/incomingCall';
import { startRingingRecheck } from '@/features/streams/ringingRecheck';
import { liveStreamQueryKey } from '@/features/streams/streamKeys';
import { getActiveChatId } from '@/store/activeChat';

function bindPersonalEvents(userId: string, queryClient: QueryClient, api = requestClient()) {
  let active = true;
  function whileCurrent<Args extends unknown[]>(handle: (...args: Args) => void) {
    return (...args: Args) => {
      if (active && api === requestClient() && confirmedAccountId(useSessionStore.getState()) === userId) handle(...args);
    };
  }

  const refreshChat = (chatId: string) => {
    void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
    void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
  };

  const channel = bindUserChannel(queryClient);
  const unsubscribe = subscribeToUserEvents(userId, {
    onHistoryRead: whileCurrent((chat) => refreshRead(queryClient, userId, chat)),
    onDisconnected: whileCurrent(channel.disconnected),
    onJoined: whileCurrent((reconnected) => {
      channel.joined();
      refreshRead(queryClient, userId);
      if (reconnected) {
        void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
        void queryClient.invalidateQueries({ queryKey: friendKeys.all });
      }
    }),
    onMessage: whileCurrent((incoming) => {
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
        incoming.chatId === getActiveChatId() ||
        incoming.messageKind === 'system' ||
        !incoming.notify
      ) {
        return;
      }

      showAlert({ kind: 'message', ...incoming });
    }),
    onPop: whileCurrent((pop) => {
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      void queryClient.invalidateQueries({
        queryKey: channelSubscriptionQueryKey(pop.channel.id),
      });
      void queryClient.invalidateQueries({ queryKey: popsQueryKey(pop.channel.id) });

      if (pop.chatId === getActiveChatId() || !pop.notify) return;

      showAlert({ kind: 'pop', ...pop });
    }),
    onInvite: whileCurrent((invite) => {
      void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
      void queryClient.invalidateQueries({ queryKey: myInviteQueryKey(invite.chatId) });

      if (invite.chatId === getActiveChatId()) return;

      showAlert({ kind: 'invite', ...invite });
    }),
    onInviteChanged: whileCurrent((chatId) => {
      // Ответ с другого моего устройства или новое сообщение в чате, куда
      // меня зовут: карточка заявки и сам чат должны это отразить.
      void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
      void queryClient.invalidateQueries({ queryKey: myInviteQueryKey(chatId) });
      refreshChat(chatId);
    }),
    onMemberJoined: whileCurrent(refreshChat),
    onIncomingCall: whileCurrent((call) => {
      void queryClient.invalidateQueries({ queryKey: liveStreamQueryKey(call.chatId) });
      ring(call);
    }),
    onStreamEnded: whileCurrent((streamId, chatId) => {
      stopRinging(streamId);
      void queryClient.invalidateQueries({ queryKey: liveStreamQueryKey(chatId) });
    }),
    // Превью откатилось — например, последнее сообщение удалили.
    onChatChanged: whileCurrent(refreshChat),
    onMembershipEnded: whileCurrent((chatId) => {
      refreshChat(chatId);

      // Ушёл из группы (может, с другого устройства) или удалили: говорить
      // в её звонке я больше не вправе.
      if (getCall()?.chatId === chatId) void leaveCall();
    }),
    // От дружбы зависит, что я вижу о человеке везде: имя или псевдоним,
    // фото, «в сети», время сообщений, медиа. Сразу перечитывается то, что
    // скорее всего на экране: друзья и заявки (вкладка «Профиль» не
    // размонтируется), профили и список чатов. Остальное — переписки,
    // ленты — только помечается устаревшим и перечитается при открытии:
    // перечитывать сейчас все загруженные страницы всех лент незачем.
    onFriendsChanged: whileCurrent(() => {
      void queryClient.invalidateQueries({ refetchType: 'none' });
      void queryClient.invalidateQueries({ queryKey: friendKeys.all });
      void queryClient.invalidateQueries({ queryKey: profileKeys.all });
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
    }),
  }, api);

  const stopRecheck = startRingingRecheck(queryClient, api);

  return () => {
    active = false;
    stopRecheck();
    channel.dispose();
    unsubscribe();
  };
}

function clearPresentation() {
  dismissAlert();
  resetRinging();
}

/** Один экземпляр на QueryClient корневого layout аккаунта. */
export function startPersonalRealtimeEvents(reader: string | null, client: QueryClient, api = requestClient()) {
  let disconnect: (() => void) | undefined;

  function sync(state: ReturnType<typeof useSessionStore.getState>) {
    if (api === requestClient() && reader && state.localAccountId === reader && confirmedAccountId(state) === reader) {
      disconnect ??= bindPersonalEvents(reader, client, api);
    } else {
      disconnect?.();
      disconnect = undefined;
    }
  }

  const unsubscribe = useSessionStore.subscribe((state, previous) => {
    const wasConnected = !!disconnect;
    sync(state);
    if (wasConnected && previous.localAccountId === reader && (api !== requestClient() || state.localAccountId !== reader)) {
      clearPresentation();
      if (getCall()) void leaveCall();
    }
  });
  sync(useSessionStore.getState());
  return () => {
    unsubscribe();
    disconnect?.();
    if (api === requestClient() && useSessionStore.getState().localAccountId === reader) clearPresentation();
  };
}
