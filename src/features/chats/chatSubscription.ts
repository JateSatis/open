import { requestClient } from '@/api/requestClient';
import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { requireAccountSession } from '@/features/auth/sessionState';
import { useHistoryReader } from '@/features/chats/messages/local/reader';

import { byChatListOrder } from '@/api/chatListOrder';
import type { ChatSummary } from '@/api/chats';
import {
  getMyChatSubscription,
  markChatSubscriptionRead,
  setChatNotifications,
  subscribeToChat,
  unsubscribeFromChat,
  type Subscription,
} from '@/api/subscriptions';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { chatQueryKey } from '@/features/chats/useChat';
import { showNotice } from '@/features/notifications/alertsStore';
import { withDeadline } from '@/lib/deadline';

/**
 * Моя подписка на чужой диалог или группу. Под ключом чата: перечитывание чата
 * после событий (`chatQueryKey` без `exact`) перечитывает и её.
 */
export const chatSubscriptionQueryKey = (chatId: string) =>
  ['chat', chatId, 'subscription'] as const;

/** Сколько ждать ответа базы на действие с подпиской, прежде чем откатить его. */
const ACTION_DEADLINE_MS = 10_000;

/**
 * Моя подписка на чат; `undefined` — ещё не известна. Спрашивает только
 * посторонний (`enabled`): участнику подписываться не на что.
 */
export function useChatSubscription(
  chatId: string,
  enabled: boolean,
): Subscription | null | undefined {
  const api = useRequestClient();
  const { data, isError } = useQuery({
    queryKey: chatSubscriptionQueryKey(chatId),
    queryFn: () => getMyChatSubscription(chatId, api),
    enabled,
  });

  if (!enabled) return null;

  // Не узнали — считаем, что не подписан: иначе низ переписки остался бы
  // пустым. Повторная подписка базе не ошибка.
  return data === undefined && isError ? null : data;
}

type Snapshot = {
  subscription: Subscription | null | undefined;
  chat: ChatSummary | undefined;
  chats: ChatSummary[] | undefined;
};

function takeSnapshot(queryClient: QueryClient, chatId: string): Snapshot {
  return {
    subscription: queryClient.getQueryData(chatSubscriptionQueryKey(chatId)),
    chat: queryClient.getQueryData(chatQueryKey(chatId)),
    chats: queryClient.getQueryData(chatsQueryKey),
  };
}

function restore(queryClient: QueryClient, chatId: string, snapshot: Snapshot) {
  queryClient.setQueryData(chatSubscriptionQueryKey(chatId), snapshot.subscription);
  queryClient.setQueryData(chatQueryKey(chatId), snapshot.chat);
  queryClient.setQueryData(chatsQueryKey, snapshot.chats);
}

/**
 * Подписка после действия — сразу во всех кешах: низ переписки, «⋮», число в
 * шапке и строка в «Чатах». Подписанный чат в список добавит перечитывание:
 * строку целиком собирать здесь не из чего.
 */
function applySubscription(
  queryClient: QueryClient,
  chatId: string,
  previous: Subscription | null,
  next: Subscription | null,
) {
  const delta = (next ? 1 : 0) - (previous ? 1 : 0);

  queryClient.setQueryData(chatSubscriptionQueryKey(chatId), next);
  queryClient.setQueryData<ChatSummary>(chatQueryKey(chatId), (chat) =>
    chat ? { ...chat, subscribersCount: Math.max(0, chat.subscribersCount + delta) } : chat,
  );
  queryClient.setQueryData<ChatSummary[]>(chatsQueryKey, (chats) =>
    chats
      ?.flatMap((chat) => {
        if (chat.id !== chatId || !chat.subscription) return [chat];
        if (!next) return [];

        return [
          {
            ...chat,
            subscription: next,
            hasUnread: next.unreadPosts > 0,
            enteredAt: next.inChatsAt ?? chat.enteredAt,
          },
        ];
      })
      .sort(byChatListOrder),
  );
}

export type ChatSubscriptionActions = {
  subscribe: () => Promise<boolean>;
  setNotify: (enabled: boolean) => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  /** «Прочитать все». */
  readAll: () => Promise<boolean>;
};

/**
 * Действия с подпиской на чат — как у канала (`useSubscriptionActions`):
 * оптимистично во всех кешах, откат и фраза об ошибке, если база отказала
 * или не ответила в срок.
 */
export function useChatSubscriptionActions(chatId: string): ChatSubscriptionActions {
  const api = useRequestClient();
  const queryClient = useQueryClient();

  const owner = useHistoryReader();
  const run = useCallback(
    async (
      next: (current: Subscription | null) => Subscription | null,
      request: () => Promise<void>,
      failure: string,
    ): Promise<boolean> => {
      const snapshot = takeSnapshot(queryClient, chatId);
      // Из «Чатов» экран чата могли ещё не открывать — тогда подписка есть
      // только в строке списка.
      const current =
        snapshot.subscription ??
        snapshot.chats?.find((chat) => chat.id === chatId)?.subscription ??
        null;

      await queryClient.cancelQueries({ queryKey: chatSubscriptionQueryKey(chatId) });
      applySubscription(queryClient, chatId, current, next(current));

      try {
        requireAccountSession(owner, api);
        await withDeadline(request(), ACTION_DEADLINE_MS);
        return true;
      } catch {
        restore(queryClient, chatId, snapshot);
        if (api === requestClient()) showNotice(failure, 'error');
        return false;
      } finally {
        void queryClient.invalidateQueries({ queryKey: chatSubscriptionQueryKey(chatId) });
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId), exact: true });
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      }
    },
    [api, chatId, owner, queryClient],
  );

  const subscribe = useCallback(
    () =>
      run(
        (current) =>
          current ?? {
            channelId: null,
            chatId,
            inChats: true,
            notify: true,
            unreadPosts: 0,
            unreadPops: 0,
            inChatsAt: new Date().toISOString(),
          },
        () => subscribeToChat(chatId, api),
        'Не удалось подписаться',
      ),
    [api, chatId, run],
  );

  const setNotify = useCallback(
    (enabled: boolean) =>
      run(
        (current) => (current ? { ...current, notify: enabled } : current),
        () => setChatNotifications(chatId, enabled, api),
        'Не удалось изменить уведомления',
      ),
    [api, chatId, run],
  );

  const unsubscribe = useCallback(
    () =>
      run(
        () => null,
        () => unsubscribeFromChat(chatId, api),
        'Не удалось отписаться',
      ),
    [api, chatId, run],
  );

  const readAll = useCallback(
    () =>
      run(
        (current) => (current ? { ...current, unreadPosts: 0 } : current),
        () => markChatSubscriptionRead(chatId, api),
        'Не удалось отметить прочитанным',
      ),
    [api, chatId, run],
  );

  return { subscribe, setNotify, unsubscribe, readAll };
}
