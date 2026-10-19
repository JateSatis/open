import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

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
  const { data, isError } = useQuery({
    queryKey: chatSubscriptionQueryKey(chatId),
    queryFn: () => getMyChatSubscription(chatId),
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
  const queryClient = useQueryClient();

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
        await withDeadline(request(), ACTION_DEADLINE_MS);
        return true;
      } catch {
        restore(queryClient, chatId, snapshot);
        showNotice(failure, 'error');
        return false;
      } finally {
        void queryClient.invalidateQueries({ queryKey: chatSubscriptionQueryKey(chatId) });
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId), exact: true });
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      }
    },
    [chatId, queryClient],
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
        () => subscribeToChat(chatId),
        'Не удалось подписаться',
      ),
    [chatId, run],
  );

  const setNotify = useCallback(
    (enabled: boolean) =>
      run(
        (current) => (current ? { ...current, notify: enabled } : current),
        () => setChatNotifications(chatId, enabled),
        'Не удалось изменить уведомления',
      ),
    [chatId, run],
  );

  const unsubscribe = useCallback(
    () =>
      run(
        () => null,
        () => unsubscribeFromChat(chatId),
        'Не удалось отписаться',
      ),
    [chatId, run],
  );

  const readAll = useCallback(
    () =>
      run(
        (current) => (current ? { ...current, unreadPosts: 0 } : current),
        () => markChatSubscriptionRead(chatId),
        'Не удалось отметить прочитанным',
      ),
    [chatId, run],
  );

  return { subscribe, setNotify, unsubscribe, readAll };
}

/**
 * Пока подписчик смотрит переписку, всё в ней прочитано — на тех же сигналах,
 * что `useMarkChatRead` у участника: вход и каждое новое сообщение. Отметка —
 * своя, в подписке: галочки «прочитано» у участников она не трогает.
 */
export function useMarkChatSubscriptionRead(
  chatId: string,
  newestMessageId: string | null,
  enabled: boolean,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!newestMessageId || !enabled) return;

    let active = true;

    markChatSubscriptionRead(chatId)
      .then(() => {
        if (!active) return;

        queryClient.setQueryData<ChatSummary[]>(chatsQueryKey, (chats) =>
          chats?.map((chat) =>
            chat.id === chatId && chat.subscription
              ? {
                  ...chat,
                  subscription: { ...chat.subscription, unreadPosts: 0 },
                  hasUnread: false,
                }
              : chat,
          ),
        );
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
        void queryClient.invalidateQueries({ queryKey: chatSubscriptionQueryKey(chatId) });
      })
      .catch(() => {
        // Как у участника: следующее сообщение или повторный вход поправят.
      });

    return () => {
      active = false;
    };
  }, [chatId, enabled, newestMessageId, queryClient]);
}
