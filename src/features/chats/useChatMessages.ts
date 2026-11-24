import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { deleteMessages as deleteOnServer, removeForwardItems } from '@/api/chats';
import {
  deliver,
  discardLocal,
  outgoingOf,
  sendPopPost,
  sendPost,
  sendVoice as sendVoiceMessage,
} from '@/features/chats/messages/delivery';
import {
  messagesQueryKey,
  mergeMessages,
  readHistory,
  removeIslandItems,
  removeMessages,
  restoreMessages,
  updateChatHistories,
  updateHistory,
  type HistoryView,
  type ChatHistory,
} from '@/features/chats/messages/historyCache';
import { isChatThreadReply } from '@/features/chats/chatThreads/replies';
import { keepDeletedChatThreadRoots } from '@/features/chats/chatThreads/sync';
import { saveEdit as saveEditOnServer } from '@/features/chats/messages/editing';
import { outboxMessages, useOutboxMessages } from '@/features/chats/messages/outbox';
import { usePendingEditsOf } from '@/features/chats/messages/pendingEdits';
import { withPendingOverlays } from '@/features/chats/messages/pendingOverlays';
import type {
  ChatMessage,
  EditResult,
  LiveQuote,
  UserActivity,
} from '@/features/chats/messages/types';
import { useChatChannel } from '@/features/chats/messages/useChatChannel';
import { useHistoryReader } from './messages/local/reader';
import type { DraftPop } from '@/features/chats/composerDraftStore';
import { useChatHistory, type ChatHistoryState } from '@/features/chats/messages/useChatHistory';
import { chatsQueryKey } from '@/features/chats/useChats';
import { pinsQueryKey } from '@/features/chats/usePinnedMessages';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import { usePendingReactionMap } from '@/features/interactions/pendingReactions';
import type { LocalMedia, OutgoingMedia } from '@/features/media';
import type { HiddenRange } from '@/features/chats/hiddenText';

export type {
  ChatMessage,
  DeliveryStatus,
  EditResult,
  EditVoice,
  ForwardItem,
  LiveQuote,
  UserActivity,
} from '@/features/chats/messages/types';
export { splitIntoAlbums } from '@/features/chats/messages/delivery';

export type ChatMessagesState = Pick<ChatHistoryState, 'readingPlace' | 'loadNewer'> & {
  /** Newest first — the list that renders them is inverted. */
  messages: ChatMessage[];
  isLoading: boolean;
  /** История не загрузилась, и показать нечего. */
  failed: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /** Кто сейчас печатает или записывает голосовое, кроме меня. */
  activities: UserActivity[];
  loadMore: () => void;
  /** Человек снова листает — догрузка истории после неудачи снова разрешена. */
  resumeLoadMore: (atEdge: boolean) => void;
  latestMessageId: string | null;
  /** Текст с альбомом; с цитатами — это ответ. */
  send: (
    text: string,
    media?: OutgoingMedia[],
    replies?: LiveQuote[],
    hidden?: HiddenRange[],
  ) => string | undefined;
  sendVoice: (voice: LocalMedia, replies?: LiveQuote[]) => string;
  /** Пост канала `channelId` с попом и необязательным текстом. */
  sendPop: (channelId: string, text: string, pop: DraftPop, replies?: LiveQuote[]) => string;
  retry: (localId: string) => void;
  /** Своё неотправленное или упавшее — убрать. На сервер ничего не уходит. */
  discard: (localId: string) => void;
  /** Сохраняет правку своего сообщения: новая версия на экране сразу. */
  saveEdit: (original: ChatMessage, result: EditResult) => void;
  /**
   * Удаляет свои сообщения для всех. С экрана они уходят сразу; если сервер
   * отказал, возвращаются на место, а ошибка пробрасывается вызвавшему.
   */
  deleteMessages: (messageIds: string[]) => Promise<void>;
  /**
   * Убирает облачка из своего островка — у всех. Оригиналы не трогаются. С
   * экрана уходят сразу; отказ сервера возвращает островок, каким его знает
   * база, и пробрасывается вызвавшему.
   */
  removeFromIsland: (forwardId: string, messageIds: string[]) => Promise<void>;
  notifyTyping: () => void;
  notifyRecordingVoice: () => void;
};

/**
 * Переписка одного чата. Собрана из частей:
 * - история (подтверждённое сервером) — в кеше TanStack Query, `useChatHistory`;
 * - исходящие (своё, ещё не подтверждённое) — в Zustand, `messages/outbox`;
 * - Realtime и «печатает» — `useChatChannel`;
 * - отправка — `messages/delivery`, вне компонентов, чтобы не обрываться с экраном.
 */
export function useChatMessages(
  chatId: string,
  currentUserId: string | null,
  view: HistoryView = 'all',
): ChatMessagesState {
  const api = useRequestClient();
  const queryClient = useQueryClient();
  const connection = useConnectionStatus();
  const reader = useHistoryReader();
  // Переписка загружена всегда: по ней дочитываются сигналы, и в обычный вид
  // возвращаются без ожидания. «Треды» — своей историей, пока они открыты.
  const allHistory = useChatHistory(chatId, 'all');
  const threadsHistory = useChatHistory(chatId, 'chat-threads', view === 'chat-threads');
  const history = view === 'all' ? allHistory : threadsHistory;
  const allOutbox = useOutboxMessages(chatId);
  // Свой неотправленный ответ в «Тредах» в ленте не стоит: он уходит в тред.
  const outbox = useMemo(
    () => (view === 'all' ? allOutbox : allOutbox.filter((message) => !isChatThreadReply(message))),
    [allOutbox, view],
  );
  const pendingEdits = usePendingEditsOf(chatId);
  const pendingReactions = usePendingReactionMap();
  const { activities, notifyTyping, notifyRecordingVoice } = useChatChannel(chatId, currentUserId);
  const wasOfflineRef = useRef(false);

  // Подтверждённое сервером может на кадр оказаться и в исходящих, и в
  // истории — показывается одно, по id.
  // Сохраняющаяся правка накладывается поверх подтверждённой версии, а моя
  // неподтверждённая реакция — поверх подтверждённых счётчиков, и у
  // оригиналов в островках тоже. Реакции у правки — из истории: пока правка
  // едет, счётчики живут своей жизнью.
  const edited = useMemo(
    () => withPendingOverlays(history.items, pendingEdits, pendingReactions),
    [history.items, pendingEdits, pendingReactions],
  );

  const messages = useMemo(() => {
    if (outbox.length === 0) return edited;

    const known = new Set(edited.map((message) => message.id));
    const pending = outbox.filter((message) => !known.has(message.id));

    return pending.length === 0 ? edited : [...pending, ...edited];
  }, [edited, outbox]);

  const latestMessageId = messages[0]?.id ?? null;

  const context = useMemo(
    () => ({ queryClient, chatId, currentUserId }),
    [chatId, currentUserId, queryClient],
  );

  useEffect(() => {
    if (connection !== 'online') {
      wasOfflineRef.current = true;
      return;
    }

    if (!wasOfflineRef.current) return;

    wasOfflineRef.current = false;

    // Связь вернулась — дописываем то, что не ушло. Пользователь уже нажал
    // «отправить»: заставлять его тыкать «повторить» по каждому сообщению
    // значит перекладывать на него работу приложения.
    for (const message of outboxMessages(chatId)) {
      const outgoing = message.status === 'failed' ? outgoingOf(message) : null;

      if (outgoing && message.localId) {
        void deliver(queryClient, chatId, currentUserId, message.localId, outgoing, api);
      }
    }
  }, [api, chatId, connection, currentUserId, queryClient]);

  const send = useCallback(
    (
      text: string,
      media: OutgoingMedia[] = [],
      replies: LiveQuote[] = [],
      hidden: HiddenRange[] = [],
    ) => sendPost(context, text, media, replies, hidden, api),
    [api, context],
  );

  const sendVoice = useCallback(
    (voice: LocalMedia, replies: LiveQuote[] = []) => sendVoiceMessage(context, voice, replies, api),
    [api, context],
  );

  const sendPop = useCallback(
    (channelId: string, text: string, pop: DraftPop, replies: LiveQuote[] = []) =>
      sendPopPost(context, channelId, text, pop, replies, api),
    [api, context],
  );

  const retry = useCallback(
    (localId: string) => {
      const failed = outboxMessages(chatId).find((message) => message.localId === localId);
      const outgoing = failed ? outgoingOf(failed) : null;

      if (!outgoing) return;

      void deliver(queryClient, chatId, currentUserId, localId, outgoing, api);
    },
    [api, chatId, currentUserId, queryClient],
  );

  const discard = useCallback((localId: string) => discardLocal(chatId, localId), [chatId]);

  const saveEdit = useCallback(
    (original: ChatMessage, result: EditResult) => void saveEditOnServer(context, original, result, api),
    [api, context],
  );

  const deleteMessages = useCallback(
    async (messageIds: string[]) => {
      const ids = new Set(messageIds);
      const removedFrom = (from: HistoryView) =>
        readHistory(queryClient, chatId, from)?.items.filter((m) => ids.has(m.id)) ?? [];
      const removed = removedFrom('all');
      const removedThreads = removedFrom('chat-threads');
      // Из всех историй чата: переписки, «Тредов» и шторок тредов.
      updateChatHistories(queryClient, chatId, (current) => removeMessages(current, ids));
      keepDeletedChatThreadRoots(queryClient, chatId, removedThreads);

      try {
        await deleteOnServer(messageIds, api);
        if (reader)
          void queryClient.invalidateQueries({ queryKey: messagesQueryKey(chatId), exact: true });
      } catch (cause) {
        updateHistory(queryClient, chatId, (current) => restoreMessages(current, removed));
        updateHistory(
          queryClient,
          chatId,
          // Заглушка удалённого исходного уступает место живому.
          (current) =>
            restoreMessages(
              { ...current, items: current.items.filter((m) => !ids.has(m.id)) },
              removedThreads,
            ),
          'chat-threads',
        );
        // Шторки треда загружаются заново: дочитывание вернуло бы только новое.
        void queryClient.resetQueries({ queryKey: [...messagesQueryKey(chatId), 'chat-thread'] });
        throw cause;
      }

      // Превью в списке чатов и закрепы база уже поправила — перечитываем.
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
    },
    [api, chatId, queryClient, reader],
  );

  const removeFromIsland = useCallback(
    async (forwardId: string, messageIds: string[]) => {
      const snapshots = queryClient
        .getQueriesData<ChatHistory>({ queryKey: messagesQueryKey(chatId) })
        .map(([key, history]) => ({
          key,
          removed: (history?.items ?? [])
            .filter((message) => message.id === forwardId)
            .map((message) => ({
              ...message,
              forward: message.forward
                ? {
                    ...message.forward,
                    items: message.forward.items.filter((item) =>
                      messageIds.includes(item.messageId),
                    ),
                  }
                : null,
            })),
        }));
      updateChatHistories(queryClient, chatId, (current) =>
        removeIslandItems(current, forwardId, new Set(messageIds)),
      );

      try {
        await removeForwardItems(forwardId, messageIds, api);
        if (reader)
          void queryClient.invalidateQueries({ queryKey: messagesQueryKey(chatId), exact: true });
      } catch (cause) {
        for (const { key, removed } of snapshots)
          queryClient.setQueryData<ChatHistory>(key, (current) =>
            current ? mergeMessages(current, removed, 'older') : current,
          );
        void queryClient.invalidateQueries({ queryKey: messagesQueryKey(chatId) });
        throw cause;
      }

      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
    },
    [api, chatId, queryClient, reader],
  );

  return {
    messages,
    readingPlace: history.readingPlace,
    loadNewer: history.loadNewer,
    isLoading: history.isLoading,
    failed: history.failed,
    isLoadingMore: history.isLoadingMore,
    hasMore: history.hasMore,
    error: history.error,
    activities,
    loadMore: history.loadMore,
    resumeLoadMore: history.resumeLoadMore,
    latestMessageId,
    send,
    sendVoice,
    sendPop,
    retry,
    discard,
    saveEdit,
    deleteMessages,
    removeFromIsland,
    notifyTyping,
    notifyRecordingVoice,
  };
}
