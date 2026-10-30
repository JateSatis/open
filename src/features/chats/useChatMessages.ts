import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  deleteMessages as deleteOnServer,
  removeForwardItems,
} from '@/api/chats';
import { mapOriginals } from '@/features/chats/islands/islandCache';
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
  readHistory,
  removeIslandItems,
  removeMessages,
  restoreMessages,
  updateChatHistories,
  updateHistory,
  type HistoryView,
} from '@/features/chats/messages/historyCache';
import { isChatThreadReply } from '@/features/chats/chatThreads/replies';
import { keepDeletedChatThreadRoots } from '@/features/chats/chatThreads/sync';
import { saveEdit as saveEditOnServer } from '@/features/chats/messages/editing';
import { outboxMessages, useOutboxMessages } from '@/features/chats/messages/outbox';
import { usePendingEditsOf } from '@/features/chats/messages/pendingEdits';
import type {
  ChatMessage,
  EditResult,
  LiveQuote,
  UserActivity,
} from '@/features/chats/messages/types';
import { useChatChannel } from '@/features/chats/messages/useChatChannel';
import type { DraftPop } from '@/features/chats/composerDraftStore';
import { useChatHistory } from '@/features/chats/messages/useChatHistory';
import { chatsQueryKey } from '@/features/chats/useChats';
import { pinsQueryKey } from '@/features/chats/usePinnedMessages';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import { usePendingReactionMap } from '@/features/interactions/pendingReactions';
import { withMyReaction } from '@/features/interactions/reactionState';
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

export type ChatMessagesState = {
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
  /** Догружает историю назад до сообщения с этим временем. Отвечает, дошли ли. */
  loadUntil: (seq: number) => Promise<boolean>;
  /** Текст с альбомом; с цитатами — это ответ. */
  send: (text: string, media?: OutgoingMedia[], replies?: LiveQuote[]) => void;
  sendVoice: (voice: LocalMedia, replies?: LiveQuote[]) => void;
  /** Пост канала `channelId` с попом и необязательным текстом. */
  sendPop: (channelId: string, text: string, pop: DraftPop, replies?: LiveQuote[]) => void;
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
  const queryClient = useQueryClient();
  const connection = useConnectionStatus();
  // Переписка загружена всегда: по ней дочитываются сигналы, и в обычный вид
  // возвращаются без ожидания. «Треды» — своей историей, пока они открыты.
  const allHistory = useChatHistory(chatId);
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
  const edited = useMemo(() => {
    if (Object.keys(pendingEdits).length === 0 && Object.keys(pendingReactions).length === 0) {
      return history.items;
    }

    return history.items.map((message) => {
      const pendingEdit = pendingEdits[message.id];
      const intent = pendingReactions[message.id];
      const base = pendingEdit
        ? { ...pendingEdit, reactions: message.reactions, commentsCount: message.commentsCount }
        : message;
      const own = intent ? { ...base, reactions: withMyReaction(base.reactions, intent) } : base;

      const withOriginals = mapOriginals(own, (original) => {
        const wanted = pendingReactions[original.id];

        return wanted
          ? { ...original, reactions: withMyReaction(original.reactions, wanted) }
          : original;
      });
      // Реакция на пересланный комментарий — его оригиналу, по id комментария.
      const forwarded = withOriginals.commentForward?.comment;
      const forComment = forwarded ? pendingReactions[forwarded.id] : undefined;

      return forwarded && forComment
        ? {
            ...withOriginals,
            commentForward: {
              ...withOriginals.commentForward!,
              comment: { ...forwarded, reactions: withMyReaction(forwarded.reactions, forComment) },
            },
          }
        : withOriginals;
    });
  }, [history.items, pendingEdits, pendingReactions]);

  const messages = useMemo(() => {
    if (outbox.length === 0) return edited;

    const known = new Set(edited.map((message) => message.id));
    const pending = outbox.filter((message) => !known.has(message.id));

    return pending.length === 0 ? edited : [...pending, ...edited];
  }, [edited, outbox]);

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
        void deliver(queryClient, chatId, currentUserId, message.localId, outgoing);
      }
    }
  }, [chatId, connection, currentUserId, queryClient]);

  const send = useCallback(
    (
      text: string,
      media: OutgoingMedia[] = [],
      replies: LiveQuote[] = [],
      hidden: HiddenRange[] = [],
    ) => sendPost(context, text, media, replies, hidden),
    [context],
  );

  const sendVoice = useCallback(
    (voice: LocalMedia, replies: LiveQuote[] = []) => sendVoiceMessage(context, voice, replies),
    [context],
  );

  const sendPop = useCallback(
    (channelId: string, text: string, pop: DraftPop, replies: LiveQuote[] = []) =>
      sendPopPost(context, channelId, text, pop, replies),
    [context],
  );

  const retry = useCallback(
    (localId: string) => {
      const failed = outboxMessages(chatId).find((message) => message.localId === localId);
      const outgoing = failed ? outgoingOf(failed) : null;

      if (!outgoing) return;

      void deliver(queryClient, chatId, currentUserId, localId, outgoing);
    },
    [chatId, currentUserId, queryClient],
  );

  const discard = useCallback((localId: string) => discardLocal(chatId, localId), [chatId]);

  const saveEdit = useCallback(
    (original: ChatMessage, result: EditResult) => void saveEditOnServer(context, original, result),
    [context],
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
        await deleteOnServer(messageIds);
      } catch (cause) {
        updateHistory(queryClient, chatId, (current) => restoreMessages(current, removed));
        updateHistory(
          queryClient,
          chatId,
          (current) => restoreMessages(current, removedThreads),
          'chat-threads',
        );
        // Шторки треда вернут своё дочитыванием.
        void queryClient.invalidateQueries({ queryKey: messagesQueryKey(chatId) });
        throw cause;
      }

      // Превью в списке чатов и закрепы база уже поправила — перечитываем.
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
    },
    [chatId, queryClient],
  );

  const removeFromIsland = useCallback(
    async (forwardId: string, messageIds: string[]) => {
      updateHistory(queryClient, chatId, (current) =>
        removeIslandItems(current, forwardId, new Set(messageIds)),
      );

      try {
        await removeForwardItems(forwardId, messageIds);
      } catch (cause) {
        // Откат — перечитать: островок таков, каким его знает база.
        void queryClient.invalidateQueries({ queryKey: messagesQueryKey(chatId) });
        throw cause;
      }

      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
    },
    [chatId, queryClient],
  );

  const { loadMore: loadMoreHistory } = history;
  const loadMore = useCallback(() => void loadMoreHistory(), [loadMoreHistory]);

  return {
    messages,
    isLoading: history.isLoading,
    failed: history.failed,
    isLoadingMore: history.isLoadingMore,
    hasMore: history.hasMore,
    error: history.error,
    activities,
    loadMore,
    resumeLoadMore: history.resumeLoadMore,
    loadUntil: history.loadUntil,
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
