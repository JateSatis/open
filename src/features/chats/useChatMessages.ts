import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteMessages as deleteOnServer,
  removeForwardItems,
} from '@/api/chats';
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
  type ChatHistory,
  type HistoryView,
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
import type { DraftPop } from '@/features/chats/composerDraftStore';
import { useChatHistory } from '@/features/chats/messages/useChatHistory';
import { refreshDetachedMessageWindows } from '@/features/chats/messages/sync';
import { loadMessageWindow, useMessageWindow } from '@/features/chats/messages/useMessageWindow';
import { messageWindowKey } from '@/features/chats/messages/historyCache';
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
  resumeLoadNewer: (atEdge: boolean) => void;
  /** Оторванное окно вокруг цели; null — живой край. */
  windowSeq: number | null;
  openWindow: (seq: number) => void;
  loadWindow: (seq: number) => Promise<boolean>;
  closeWindow: () => void;
  loadNewer: () => void;
  hasNewer: boolean;
  newMessagesCount: number;
  acknowledgeLatest: () => void;
  markAwayFromLatest: () => void;
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
  initialWindowSeq: number | null = null,
): ChatMessagesState {
  const queryClient = useQueryClient();
  const connection = useConnectionStatus();
  // Переписка загружена всегда: по ней дочитываются сигналы, и в обычный вид
  // возвращаются без ожидания. «Треды» — своей историей, пока они открыты.
  const [windowSeq, setWindowSeq] = useState(initialWindowSeq);
  const [windowBaseline, setWindowBaseline] = useState<number | null>(null);
  const window = useMessageWindow(chatId, windowSeq, readHistory(queryClient, chatId));
  useEffect(() => {
    if (windowSeq === null || window.dataUpdatedAt === 0 || Date.now() - window.dataUpdatedAt < 30_000) return;
    void refreshDetachedMessageWindows(queryClient, chatId);
  }, [chatId, queryClient, window.dataUpdatedAt, windowSeq]);
  const tailEnabled = windowSeq === null || window.history !== undefined;
  const allHistory = useChatHistory(chatId, 'all', tailEnabled);
  useEffect(() => {
    if (windowSeq !== null && windowBaseline === null && allHistory.items[0]) {
      const top = allHistory.items[0].seq;
      const timer = setTimeout(() => setWindowBaseline(top), 0);
      return () => clearTimeout(timer);
    }
  }, [allHistory.items, windowBaseline, windowSeq]);
  const threadsHistory = useChatHistory(chatId, 'chat-threads', view === 'chat-threads');
  const history = view === 'all' ? allHistory : threadsHistory;
  const inWindow = view === 'all' && windowSeq !== null;
  const shownItems = useMemo(
    () => inWindow ? (window.history?.items ?? history.items) : history.items,
    [history.items, inWindow, window.history?.items],
  );
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
    () => withPendingOverlays(shownItems, pendingEdits, pendingReactions),
    [shownItems, pendingEdits, pendingReactions],
  );

  const messages = useMemo(() => {
    if (outbox.length === 0 || inWindow) return edited;

    const known = new Set(edited.map((message) => message.id));
    const pending = outbox.filter((message) => !known.has(message.id));

    return pending.length === 0 ? edited : [...pending, ...edited];
  }, [edited, inWindow, outbox]);

  const openWindow = useCallback((seq: number) => {
    const tail = readHistory(queryClient, chatId);
    setWindowBaseline(tail?.items[0]?.seq ?? seq);
    setWindowSeq(seq);
  }, [chatId, queryClient]);
  const loadWindow = useCallback(async (seq: number) => {
    try {
      const result = await queryClient.fetchQuery({
        queryKey: messageWindowKey(chatId, seq),
        queryFn: () => loadMessageWindow(chatId, seq),
        staleTime: Infinity,
      });
      if (!result.items.some((message) => message.seq === seq)) return false;
      openWindow(seq);
      return true;
    } catch {
      return false;
    }
  }, [chatId, openWindow, queryClient]);
  const closeWindow = useCallback(() => { setWindowSeq(null); setWindowBaseline(null); }, []);
  const acknowledgeLatest = useCallback(() => {
    setWindowBaseline(readHistory(queryClient, chatId)?.items[0]?.seq ?? null);
  }, [chatId, queryClient]);
  const markAwayFromLatest = useCallback(() => {
    setWindowBaseline((current) => current ?? readHistory(queryClient, chatId)?.items[0]?.seq ?? null);
  }, [chatId, queryClient]);
  const latestMessageId = (inWindow ? allHistory.items[0] : messages[0])?.id ?? null;
  const newMessagesCount = windowBaseline !== null
    ? allHistory.items.filter((message) => message.seq > windowBaseline).length
    : 0;
  const hasNewer = inWindow && window.history !== undefined && window.history.newerCursor !== null;

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

    void refreshDetachedMessageWindows(queryClient, chatId);

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
      const removedWindows = queryClient
        .getQueriesData<ChatHistory>({ queryKey: ['message-window', chatId] })
        .map(([key, history]) => [key, history?.items.filter((message) => ids.has(message.id)) ?? []] as const);

      // Из всех историй чата: переписки, «Тредов» и шторок тредов.
      updateChatHistories(queryClient, chatId, (current) => removeMessages(current, ids));
      keepDeletedChatThreadRoots(queryClient, chatId, removedThreads);

      try {
        await deleteOnServer(messageIds);
      } catch (cause) {
        updateHistory(queryClient, chatId, (current) => restoreMessages(current, removed));
        for (const [key, windowItems] of removedWindows) {
          queryClient.setQueryData<ChatHistory>(key, (current) =>
            current ? restoreMessages(current, windowItems) : current,
          );
        }
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
    [chatId, queryClient],
  );

  const removeFromIsland = useCallback(
    async (forwardId: string, messageIds: string[]) => {
      updateChatHistories(queryClient, chatId, (current) =>
        removeIslandItems(current, forwardId, new Set(messageIds)),
      );

      try {
        await removeForwardItems(forwardId, messageIds);
      } catch (cause) {
        // Откат — перечитать: островок таков, каким его знает база.
        void queryClient.invalidateQueries({ queryKey: messagesQueryKey(chatId) });
        void queryClient.invalidateQueries({ queryKey: ['message-window', chatId] });
        throw cause;
      }

      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
    },
    [chatId, queryClient],
  );

  const { loadMore: loadMoreHistory } = history;
  const loadMore = useCallback(() => void (inWindow ? window.loadOlder() : loadMoreHistory()), [inWindow, loadMoreHistory, window]);

  return {
    messages,
    isLoading: inWindow ? window.isLoading : history.isLoading,
    failed: inWindow ? window.failed : history.failed,
    isLoadingMore: inWindow ? window.loadingOlder : history.isLoadingMore,
    hasMore: inWindow ? window.history?.nextCursor != null : history.hasMore,
    error: inWindow ? window.error : history.error,
    activities,
    loadMore,
    resumeLoadMore: inWindow ? () => window.resumeOlder() : history.resumeLoadMore,
    resumeLoadNewer: inWindow ? () => void window.resumeNewer() : () => undefined,
    windowSeq,
    openWindow,
    loadWindow,
    closeWindow,
    loadNewer: () => void window.loadNewer(),
    hasNewer,
    newMessagesCount,
    acknowledgeLatest,
    markAwayFromLatest,
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
