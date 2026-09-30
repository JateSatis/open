import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { deleteMessages as deleteOnServer } from '@/api/chats';
import {
  deliver,
  discardLocal,
  outgoingOf,
  sendForward,
  sendPost,
  sendVoice as sendVoiceMessage,
} from '@/features/chats/messages/delivery';
import {
  readHistory,
  removeMessages,
  restoreMessages,
  updateHistory,
} from '@/features/chats/messages/historyCache';
import { saveEdit as saveEditOnServer } from '@/features/chats/messages/editing';
import { outboxMessages, useOutboxMessages } from '@/features/chats/messages/outbox';
import { usePendingEditsOf } from '@/features/chats/messages/pendingEdits';
import type {
  ChatMessage,
  EditResult,
  ForwardItem,
  LiveQuote,
  UserActivity,
} from '@/features/chats/messages/types';
import { useChatChannel } from '@/features/chats/messages/useChatChannel';
import { useChatHistory } from '@/features/chats/messages/useChatHistory';
import { chatsQueryKey } from '@/features/chats/useChats';
import { pinsQueryKey } from '@/features/chats/usePinnedMessages';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import { usePendingReactionsOf } from '@/features/interactions/pendingReactions';
import { withMyReaction } from '@/features/interactions/reactionState';
import type { LocalMedia, MediaLibraryItem } from '@/features/media';

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
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /** Кто сейчас печатает или записывает голосовое, кроме меня. */
  activities: UserActivity[];
  loadMore: () => void;
  /** Догружает историю назад до сообщения с этим временем. Отвечает, дошли ли. */
  loadUntil: (createdAt: string) => Promise<boolean>;
  /** Текст с альбомом; с цитатами — это ответ. */
  send: (text: string, media?: MediaLibraryItem[], replies?: LiveQuote[]) => void;
  sendVoice: (voice: LocalMedia, replies?: LiveQuote[]) => void;
  /** Пересылка сюда; текст из поля уходит перед пересланными. */
  forward: (text: string, items: ForwardItem[]) => void;
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
export function useChatMessages(chatId: string, currentUserId: string | null): ChatMessagesState {
  const queryClient = useQueryClient();
  const connection = useConnectionStatus();
  const history = useChatHistory(chatId);
  const outbox = useOutboxMessages(chatId);
  const pendingEdits = usePendingEditsOf(chatId);
  const pendingReactions = usePendingReactionsOf(chatId);
  const { activities, notifyTyping, notifyRecordingVoice } = useChatChannel(chatId, currentUserId);
  const wasOfflineRef = useRef(false);

  // Подтверждённое сервером может на кадр оказаться и в исходящих, и в
  // истории — показывается одно, по id.
  // Сохраняющаяся правка накладывается поверх подтверждённой версии, а моя
  // неподтверждённая реакция — поверх подтверждённых счётчиков. Реакции у
  // правки — из истории: пока правка едет, счётчики живут своей жизнью.
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

      return intent ? { ...base, reactions: withMyReaction(base.reactions, intent) } : base;
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
    (text: string, media: MediaLibraryItem[] = [], replies: LiveQuote[] = []) =>
      sendPost(context, text, media, replies),
    [context],
  );

  const sendVoice = useCallback(
    (voice: LocalMedia, replies: LiveQuote[] = []) => sendVoiceMessage(context, voice, replies),
    [context],
  );

  const forward = useCallback(
    (text: string, items: ForwardItem[]) => sendForward(context, text, items),
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
      const removed = readHistory(queryClient, chatId)?.items.filter((m) => ids.has(m.id)) ?? [];

      updateHistory(queryClient, chatId, (current) => removeMessages(current, ids));

      try {
        await deleteOnServer(messageIds);
      } catch (cause) {
        updateHistory(queryClient, chatId, (current) => restoreMessages(current, removed));
        throw cause;
      }

      // Превью в списке чатов и закрепы база уже поправила — перечитываем.
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
    isLoadingMore: history.isLoadingMore,
    hasMore: history.hasMore,
    error: history.error,
    activities,
    loadMore,
    loadUntil: history.loadUntil,
    send,
    sendVoice,
    forward,
    retry,
    discard,
    saveEdit,
    deleteMessages,
    notifyTyping,
    notifyRecordingVoice,
  };
}
