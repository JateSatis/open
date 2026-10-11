import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { Channel } from '@/api/channels';
import type { ChatSummary } from '@/api/chats';
import {
  markChannelRead,
  setChannelInChats,
  setChannelNotifications,
  subscribeToChannel,
  unsubscribeFromChannel,
  type ChannelSubscription,
} from '@/api/subscriptions';
import { channelQueryKey, channelSubscriptionQueryKey } from '@/features/channels/keys';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { showNotice } from '@/features/notifications/alertsStore';
import { withDeadline } from '@/lib/deadline';

export { channelSubscriptionQueryKey };

/** Сколько ждать ответа базы на действие с подпиской, прежде чем откатить его. */
const ACTION_DEADLINE_MS = 10_000;

type Snapshot = {
  subscription: ChannelSubscription | null | undefined;
  channel: Channel | undefined;
  chats: ChatSummary[] | undefined;
};

function takeSnapshot(queryClient: QueryClient, channelId: string): Snapshot {
  return {
    subscription: queryClient.getQueryData(channelSubscriptionQueryKey(channelId)),
    channel: queryClient.getQueryData(channelQueryKey(channelId)),
    chats: queryClient.getQueryData(chatsQueryKey),
  };
}

function restore(queryClient: QueryClient, channelId: string, snapshot: Snapshot) {
  queryClient.setQueryData(channelSubscriptionQueryKey(channelId), snapshot.subscription);
  queryClient.setQueryData(channelQueryKey(channelId), snapshot.channel);
  queryClient.setQueryData(chatsQueryKey, snapshot.chats);
}

/** Чат постов канала — из любого кеша, где он уже есть. */
function postsChatOf(queryClient: QueryClient, channelId: string): string | null {
  const subscription = queryClient.getQueryData<ChannelSubscription | null>(
    channelSubscriptionQueryKey(channelId),
  );
  const channel = queryClient.getQueryData<Channel>(channelQueryKey(channelId));
  const listed = queryClient
    .getQueryData<ChatSummary[]>(chatsQueryKey)
    ?.find((chat) => chat.channel?.id === channelId);

  return subscription?.chatId ?? channel?.postsChatId ?? listed?.id ?? null;
}

/**
 * Подписка после действия — сразу во всех кешах: кнопки, числа в шапке и
 * строка в «Чатах». Канал, ставший читаемым, в список добавит перечитывание:
 * строку целиком собирать здесь не из чего.
 */
function applySubscription(
  queryClient: QueryClient,
  channelId: string,
  next: ChannelSubscription | null,
) {
  const previous = queryClient.getQueryData<ChannelSubscription | null>(
    channelSubscriptionQueryKey(channelId),
  );
  const subscribersDelta = (next ? 1 : 0) - (previous ? 1 : 0);
  const readersDelta = (next?.inChats ? 1 : 0) - (previous?.inChats ? 1 : 0);

  queryClient.setQueryData(channelSubscriptionQueryKey(channelId), next);
  queryClient.setQueryData<Channel>(channelQueryKey(channelId), (channel) =>
    channel
      ? {
          ...channel,
          subscribersCount: Math.max(0, channel.subscribersCount + subscribersDelta),
          readersCount: Math.max(0, channel.readersCount + readersDelta),
        }
      : channel,
  );
  queryClient.setQueryData<ChatSummary[]>(chatsQueryKey, (chats) =>
    chats?.flatMap((chat) => {
      if (chat.channel?.id !== channelId || !chat.subscription) return [chat];
      if (!next?.inChats) return [];

      const unread = next.unreadPosts + next.unreadPops > 0;

      return [{ ...chat, subscription: next, hasUnread: unread }];
    }),
  );
}

export type SubscriptionActions = {
  /** Подписаться; `addToChats` — сразу читателем. Отдаёт, удалось ли. */
  subscribe: (addToChats: boolean) => Promise<boolean>;
  setInChats: (inChats: boolean) => Promise<boolean>;
  setNotify: (enabled: boolean) => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  /** «Прочитать все»: и посты, и попсы. */
  readAll: () => Promise<boolean>;
};

/**
 * Действия с подпиской: оптимистично во всех кешах, откат и фраза об ошибке,
 * если база отказала или не ответила в срок. Срок — потому что без связи
 * кнопка иначе ждала бы бесконечно, а действие выполнилось бы само при
 * возврате сети, когда о нём уже забыли.
 */
export function useSubscriptionActions(channelId: string): SubscriptionActions {
  const queryClient = useQueryClient();

  const run = useCallback(
    async (
      next: (current: ChannelSubscription | null) => ChannelSubscription | null,
      request: () => Promise<void>,
      failure: string,
    ): Promise<boolean> => {
      const snapshot = takeSnapshot(queryClient, channelId);
      const current = snapshot.subscription ?? null;

      await queryClient.cancelQueries({ queryKey: channelSubscriptionQueryKey(channelId) });
      applySubscription(queryClient, channelId, next(current));

      try {
        await withDeadline(request(), ACTION_DEADLINE_MS);
        return true;
      } catch {
        restore(queryClient, channelId, snapshot);
        showNotice(failure, 'error');
        return false;
      } finally {
        void queryClient.invalidateQueries({ queryKey: channelSubscriptionQueryKey(channelId) });
        void queryClient.invalidateQueries({ queryKey: channelQueryKey(channelId), exact: true });
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      }
    },
    [channelId, queryClient],
  );

  const subscribe = useCallback(
    (addToChats: boolean) =>
      run(
        (current) =>
          current
            ? { ...current, inChats: current.inChats || addToChats }
            : {
                channelId,
                chatId: postsChatOf(queryClient, channelId) ?? '',
                inChats: addToChats,
                notify: true,
                unreadPosts: 0,
                unreadPops: 0,
              },
        () => subscribeToChannel(channelId, addToChats),
        'Не удалось подписаться',
      ),
    [channelId, queryClient, run],
  );

  const setInChats = useCallback(
    (inChats: boolean) =>
      run(
        (current) => (current ? { ...current, inChats } : current),
        () => setChannelInChats(channelId, inChats),
        inChats ? 'Не удалось добавить в чаты' : 'Не удалось убрать из чатов',
      ),
    [channelId, run],
  );

  const setNotify = useCallback(
    (enabled: boolean) =>
      run(
        (current) => (current ? { ...current, notify: enabled } : current),
        () => setChannelNotifications(channelId, enabled),
        'Не удалось изменить уведомления',
      ),
    [channelId, run],
  );

  const unsubscribe = useCallback(
    () =>
      run(
        () => null,
        () => unsubscribeFromChannel(channelId),
        'Не удалось отписаться',
      ),
    [channelId, run],
  );

  const readAll = useCallback(
    () =>
      run(
        (current) => (current ? { ...current, unreadPosts: 0, unreadPops: 0 } : current),
        () => markChannelRead(channelId, { posts: true, pops: true }),
        'Не удалось отметить прочитанным',
      ),
    [channelId, run],
  );

  return { subscribe, setInChats, setNotify, unsubscribe, readAll };
}

export type { ChannelSection } from '@/features/channels/useMarkChannelSectionRead';
