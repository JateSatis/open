import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { forgetAvatarUrls } from '@/api/avatars';
import { forgetChatMediaUrls } from '@/api/chatMedia';
import {
  getTypingAudience,
  subscribeToChat,
  type ChatActivity,
  type ChatChannel,
  type TypingAudience,
} from '@/api/chats';
import { isChatMember } from '@/features/chats/chatDisplay';
import { messagesQueryKey } from '@/features/chats/messages/historyCache';
import {
  dropDeletedMessages,
  pullNewMessages,
  refreshCommentCounts,
  refreshEditedMessages,
  refreshChatTimes,
  refreshClusterCounts,
  refreshIsland,
  refreshReactions,
  refreshViews,
} from '@/features/chats/messages/sync';
import type { UserActivity } from '@/features/chats/messages/types';
import { chatQueryKey, useChat } from '@/features/chats/useChat';
import { pinsQueryKey } from '@/features/chats/usePinnedMessages';
import { liveStreamQueryKey } from '@/features/streams/streamKeys';

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

type Batch = { ids: Set<string>; timer: ReturnType<typeof setTimeout> | null };

/**
 * Сколько верить ответу «кому слать печатает». Он зависит от моей настройки
 * (её смена сбрасывает ответ сразу) и от того, все ли участники мне друзья, —
 * это меняется редко.
 */
const TYPING_AUDIENCE_STALE_MS = 60_000;

export function typingAudienceKey(chatId: string) {
  return ['typingAudience', chatId] as const;
}

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
  const { chat } = useChat(chatId);
  const isMember = chat ? isChatMember(chat, currentUserId) : false;
  // Куда слать мои «печатает»: решает база по моей настройке «Кто видит, что
  // я в сети». Пока ответа нет — никуда: лучше промолчать, чем показаться.
  const { data: audience = 'none' } = useQuery({
    queryKey: typingAudienceKey(chatId),
    queryFn: () => getTypingAudience(chatId),
    enabled: isMember,
    staleTime: TYPING_AUDIENCE_STALE_MS,
  });
  const audienceRef = useRef<TypingAudience>('none');

  useEffect(() => {
    audienceRef.current = isMember ? audience : 'none';
  }, [audience, isMember]);
  const [activities, setActivities] = useState<UserActivity[]>([]);
  const channelRef = useRef<ChatChannel | null>(null);
  const typingTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastActivitySentRef = useRef<{ activity: ChatActivity; at: number } | null>(null);
  const reactionBatchRef = useRef<Batch>({ ids: new Set(), timer: null });
  // Числа комментариев — той же пачкой, что и реакции: горячее сообщение
  // комментируют так же часто, как на него реагируют.
  const commentBatchRef = useRef<Batch>({ ids: new Set(), timer: null });
  // Просмотры — тоже: каждый зритель шлёт пачку раз в пару секунд.
  const viewBatchRef = useRef<Batch>({ ids: new Set(), timer: null });
  const clusterBatchRef = useRef<Batch>({ ids: new Set(), timer: null });

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
    void queryClient.invalidateQueries({ queryKey: liveStreamQueryKey(chatId) });
  }, [chatId, queryClient]);

  useEffect(() => {
    const timers = typingTimersRef.current;
    const reactionBatch = reactionBatchRef.current;
    const commentBatch = commentBatchRef.current;
    const viewBatch = viewBatchRef.current;
    const clusterBatch = clusterBatchRef.current;

    // Не вышло перечитать — дочитаем при следующем событии или переподключении.
    const collect = (
      batch: Batch,
      refresh: (client: typeof queryClient, ids: string[]) => Promise<void>,
      messageId: string,
    ) => {
      batch.ids.add(messageId);

      if (batch.timer) return;

      batch.timer = setTimeout(() => {
        const ids = [...batch.ids];

        batch.ids.clear();
        batch.timer = null;
        refresh(queryClient, ids).catch(() => undefined);
      }, REACTIONS_BATCH_MS);
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
      onChatChanged: () => {
        // Название, описание, состав, заявки — или чат удалили.
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
      },
      onRead: () => {
        // Отметка собеседника живёт в участниках чата, а не в сообщениях —
        // перечитываем именно чат, история при этом не дёргается.
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
      },
      onMessagesDeleted: (messageIds) => {
        // Не вышло сверить — сверим при следующем событии или переподключении.
        dropDeletedMessages(queryClient, messageIds).catch(() => undefined);
      },
      onMessageEdited: (messageId) => {
        refreshEditedMessages(queryClient, [messageId]).catch(() => undefined);
        // Правленое могло быть закреплено — полоса показывает его текст.
        void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
      },
      onStreamChanged: () => {
        // Числа и сам факт звонка — из базы; payload только будит.
        void queryClient.invalidateQueries({ queryKey: liveStreamQueryKey(chatId) });
      },
      onTimeVisibilityChanged: () => {
        // Участник сменил, кому видно время: время, даты и прочтение у
        // загруженных сообщений и у участников — перечитать на месте.
        refreshChatTimes(queryClient, chatId).catch(() => undefined);
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
      },
      onPeopleChanged: () => {
        // Кто-то сменил, кому виден он сам: имена, фото и id авторов у
        // загруженных сообщений и участники — глазами меня заново. Прежние
        // подписанные ссылки на фото могли стать чужими.
        forgetAvatarUrls();
        refreshChatTimes(queryClient, chatId).catch(() => undefined);
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
      },
      onMediaChanged: () => {
        // Участник сменил, кому видно его медиа: пути и плитки «скрыто
        // автором» у загруженных сообщений и во вкладках — глазами меня
        // заново, прежние подписанные ссылки могли стать чужими.
        forgetChatMediaUrls();
        refreshChatTimes(queryClient, chatId).catch(() => undefined);
        // Ключ чата — префикс и вкладок «Медиа» и «Голосовые».
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
      },
      onPinsChanged: () => {
        void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
      },
      onForwardChanged: (forwardId) => {
        refreshIsland(queryClient, chatId, forwardId).catch(() => undefined);
        // Закреп убранного облачка база уже сняла.
        void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
      },
      onReactionsChanged: (messageId) => collect(reactionBatch, refreshReactions, messageId),
      onCommentsChanged: (messageId) => collect(commentBatch, refreshCommentCounts, messageId),
      onClustersChanged: (messageId) => collect(clusterBatch, refreshClusterCounts, messageId),
      onViewsChanged: (messageIds) =>
        messageIds.forEach((messageId) => collect(viewBatch, refreshViews, messageId)),
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
    }, isMember);

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      channel.unsubscribe();
      timers.forEach(clearTimeout);
      timers.clear();

      for (const batch of [reactionBatch, commentBatch, viewBatch, clusterBatch]) {
        if (batch.timer) clearTimeout(batch.timer);

        batch.timer = null;
        batch.ids.clear();
      }
      setActivities([]);
    };
  }, [catchUp, chatId, currentUserId, isMember, onNewMessage, queryClient]);

  const notifyActivity = useCallback(
    (activity: ChatActivity) => {
      if (!currentUserId) return;

      const now = Date.now();
      const last = lastActivitySentRef.current;

      // Смена занятия уходит сразу: начал записывать — собеседник должен
      // увидеть это, а не ещё две секунды «печатает…».
      if (last && last.activity === activity && now - last.at < TYPING_THROTTLE_MS) return;

      lastActivitySentRef.current = { activity, at: now };
      channelRef.current?.broadcastTyping(currentUserId, activity, audienceRef.current);
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
