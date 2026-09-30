import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { subscribeToChat, type ChatActivity, type ChatChannel } from '@/api/chats';
import { messagesQueryKey } from '@/features/chats/messages/historyCache';
import {
  dropDeletedMessages,
  pullNewMessages,
  refreshEditedMessages,
  refreshReactions,
} from '@/features/chats/messages/sync';
import type { UserActivity } from '@/features/chats/messages/types';
import { chatQueryKey } from '@/features/chats/useChat';
import { pinsQueryKey } from '@/features/chats/usePinnedMessages';

/** How long a "печатает…" mark survives without another typing broadcast. */
const TYPING_TIMEOUT_MS = 4000;
/** Lower bound between two typing broadcasts, so a fast typist sends a few. */
const TYPING_THROTTLE_MS = 2000;
/**
 * Столько копить события реакций, прежде чем перечитать счётчики. На горячее
 * сообщение реакции сыплются десятками в секунду — база получает один запрос
 * на пачку, а не по запросу на событие.
 */
const REACTIONS_BATCH_MS = 500;

export type ChatChannelState = {
  /** Кто сейчас печатает или записывает голосовое, кроме меня. */
  activities: UserActivity[];
  notifyTyping: () => void;
  notifyRecordingVoice: () => void;
};

/**
 * Канал чата: новые сообщения, удаления, правки, закрепы, реакции, прочтения,
 * «печатает».
 * Payload любого события — только сигнал: строки всегда перечитываются из
 * базы, где видимость решает RLS, так что поддельное событие ничего не
 * добавит в чужую переписку и ничего из неё не уберёт.
 */
export function useChatChannel(chatId: string, currentUserId: string | null): ChatChannelState {
  const queryClient = useQueryClient();
  const [activities, setActivities] = useState<UserActivity[]>([]);
  const channelRef = useRef<ChatChannel | null>(null);
  const typingTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastActivitySentRef = useRef<{ activity: ChatActivity; at: number } | null>(null);
  const reactionBatchRef = useRef<{
    ids: Set<string>;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ ids: new Set(), timer: null });

  const onNewMessage = useCallback(async () => {
    try {
      const incoming = await pullNewMessages(queryClient, chatId);

      // Сообщение пришло — «печатает…» и «записывает…» его автора больше
      // не правда, ждать таймаута незачем.
      const timers = typingTimersRef.current;
      const authors = new Set(
        incoming.flatMap((message) => (message.authorId ? [message.authorId] : [])),
      );

      if (authors.size === 0) return;

      setActivities((current) => current.filter((entry) => !authors.has(entry.userId)));
      authors.forEach((authorId) => {
        clearTimeout(timers.get(authorId));
        timers.delete(authorId);
      });
    } catch {
      // A failed catch-up is not worth an error banner: the next broadcast or
      // a re-entry into the chat reloads the page anyway.
    }
  }, [chatId, queryClient]);

  const catchUp = useCallback(() => {
    // Пока канала не было, события терялись: сообщения, удаления, закрепы и
    // чужие отметки прочтения. Перезапрос истории — это дочитывание (см.
    // `loadHistory`), а не перезагрузка.
    void queryClient.invalidateQueries({ queryKey: messagesQueryKey(chatId) });
    void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
    void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
  }, [chatId, queryClient]);

  useEffect(() => {
    const timers = typingTimersRef.current;
    const reactionBatch = reactionBatchRef.current;

    const flushReactions = () => {
      const ids = [...reactionBatch.ids];

      reactionBatch.ids.clear();
      reactionBatch.timer = null;
      // Не вышло — дочитаем при следующем событии или переподключении.
      refreshReactions(queryClient, chatId, ids).catch(() => undefined);
    };

    const channel = subscribeToChat(chatId, {
      onMessage: () => {
        void onNewMessage();
      },
      onReconnected: catchUp,
      onMembersChanged: () => {
        // Кто-то принял заявку: состав и «ещё не ответил» живут в чате.
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
      },
      onRead: () => {
        // Отметка собеседника живёт в участниках чата, а не в сообщениях —
        // перечитываем именно чат, история при этом не дёргается.
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
      },
      onMessagesDeleted: (messageIds) => {
        // Не вышло сверить — сверим при следующем событии или переподключении.
        dropDeletedMessages(queryClient, chatId, messageIds).catch(() => undefined);
      },
      onMessageEdited: (messageId) => {
        refreshEditedMessages(queryClient, chatId, [messageId]).catch(() => undefined);
        // Правленое могло быть закреплено — полоса показывает его текст.
        void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
      },
      onPinsChanged: () => {
        void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
      },
      onReactionsChanged: (messageId) => {
        reactionBatch.ids.add(messageId);

        if (!reactionBatch.timer) reactionBatch.timer = setTimeout(flushReactions, REACTIONS_BATCH_MS);
      },
      onTyping: (userId, activity) => {
        if (userId === currentUserId) return;

        setActivities((current) => {
          const existing = current.find((entry) => entry.userId === userId);

          if (existing?.activity === activity) return current;

          return [...current.filter((entry) => entry.userId !== userId), { userId, activity }];
        });

        const running = timers.get(userId);

        if (running) clearTimeout(running);

        timers.set(
          userId,
          setTimeout(() => {
            timers.delete(userId);
            setActivities((current) => current.filter((entry) => entry.userId !== userId));
          }, TYPING_TIMEOUT_MS),
        );
      },
    });

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      channel.unsubscribe();
      timers.forEach(clearTimeout);
      timers.clear();

      if (reactionBatch.timer) clearTimeout(reactionBatch.timer);

      reactionBatch.timer = null;
      reactionBatch.ids.clear();
      setActivities([]);
    };
  }, [catchUp, chatId, currentUserId, onNewMessage, queryClient]);

  const notifyActivity = useCallback(
    (activity: ChatActivity) => {
      if (!currentUserId) return;

      const now = Date.now();
      const last = lastActivitySentRef.current;

      // Смена занятия уходит сразу: начал записывать — собеседник должен
      // увидеть это, а не ещё две секунды «печатает…».
      if (last && last.activity === activity && now - last.at < TYPING_THROTTLE_MS) return;

      lastActivitySentRef.current = { activity, at: now };
      channelRef.current?.broadcastTyping(currentUserId, activity);
    },
    [currentUserId],
  );

  const notifyTyping = useCallback(() => notifyActivity('typing'), [notifyActivity]);
  const notifyRecordingVoice = useCallback(
    () => notifyActivity('recording_voice'),
    [notifyActivity],
  );

  return { activities, notifyTyping, notifyRecordingVoice };
}
