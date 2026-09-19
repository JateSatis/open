import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  listMessages,
  listMessagesSince,
  sendMessage,
  subscribeToChat,
  type ChatChannel,
  type Message,
} from '@/api/chats';
import { chatQueryKey } from '@/features/chats/useChat';
import { chatsQueryKey } from '@/features/chats/useChats';

/** How long a "печатает…" mark survives without another typing broadcast. */
const TYPING_TIMEOUT_MS = 4000;
/** Lower bound between two typing broadcasts, so a fast typist sends a few. */
const TYPING_THROTTLE_MS = 2000;

export type DeliveryStatus = 'sending' | 'sent' | 'failed';

export type ChatMessage = Message & {
  status: DeliveryStatus;
  /** Set only while the message exists optimistically, before the server id. */
  localId?: string;
};

export type ChatMessagesState = {
  /** Newest first — the list that renders them is inverted. */
  messages: ChatMessage[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  typingUserIds: string[];
  loadMore: () => void;
  send: (text: string) => void;
  retry: (localId: string) => void;
  notifyTyping: () => void;
};

let localIdCounter = 0;

function nextLocalId(): string {
  localIdCounter += 1;
  return `local-${Date.now()}-${localIdCounter}`;
}

function mergeNewest(existing: ChatMessage[], incoming: Message[]): ChatMessage[] {
  if (incoming.length === 0) return existing;

  const known = new Set(existing.map((message) => message.id));
  const added: ChatMessage[] = incoming
    .filter((message) => !known.has(message.id))
    .map((message) => ({ ...message, status: 'sent' as const }));

  if (added.length === 0) return existing;

  return [...added.reverse(), ...existing];
}

export function useChatMessages(chatId: string, currentUserId: string | null): ChatMessagesState {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  // Mirrors `cursorRef` for rendering: the ref is what callbacks read, but a
  // ref must not be touched during render.
  const [hasMore, setHasMore] = useState(false);

  const cursorRef = useRef<string | null>(null);
  const latestServerAtRef = useRef<string | null>(null);
  const channelRef = useRef<ChatChannel | null>(null);
  const typingTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastTypingSentAtRef = useRef(0);

  const rememberLatest = useCallback((createdAt: string) => {
    if (!latestServerAtRef.current || createdAt > latestServerAtRef.current) {
      latestServerAtRef.current = createdAt;
    }
  }, []);

  const pullNewMessages = useCallback(async () => {
    const since = latestServerAtRef.current;

    if (!since) return;

    try {
      const incoming = await listMessagesSince(chatId, since);

      if (incoming.length === 0) return;

      rememberLatest(incoming[incoming.length - 1].createdAt);
      setMessages((current) => mergeNewest(current, incoming));
    } catch {
      // A failed catch-up is not worth an error banner: the next broadcast or
      // a re-entry into the chat reloads the page anyway.
    }
  }, [chatId, rememberLatest]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      setMessages([]);
      cursorRef.current = null;
      latestServerAtRef.current = null;

      try {
        const page = await listMessages(chatId);

        if (!active) return;

        cursorRef.current = page.nextCursor;
        setHasMore(page.nextCursor !== null);

        if (page.items.length > 0) rememberLatest(page.items[0].createdAt);

        setMessages(page.items.map((message) => ({ ...message, status: 'sent' as const })));
        setError(null);
      } catch (cause) {
        if (!active) return;

        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить сообщения');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [chatId, rememberLatest]);

  useEffect(() => {
    const timers = typingTimersRef.current;

    const channel = subscribeToChat(chatId, {
      onMessage: () => {
        void pullNewMessages();
      },
      onRead: () => {
        // Отметка собеседника живёт в участниках чата, а не в сообщениях —
        // перечитываем именно чат, история при этом не дёргается.
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
      },
      onTyping: (userId) => {
        if (userId === currentUserId) return;

        setTypingUserIds((current) => (current.includes(userId) ? current : [...current, userId]));

        const running = timers.get(userId);

        if (running) clearTimeout(running);

        timers.set(
          userId,
          setTimeout(() => {
            timers.delete(userId);
            setTypingUserIds((current) => current.filter((id) => id !== userId));
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
      setTypingUserIds([]);
    };
  }, [chatId, currentUserId, pullNewMessages, queryClient]);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;

    if (!cursor || isLoadingMore) return;

    setIsLoadingMore(true);

    listMessages(chatId, { cursor })
      .then((page) => {
        cursorRef.current = page.nextCursor;
        setHasMore(page.nextCursor !== null);
        setMessages((current) => [
          ...current,
          ...page.items.map((message) => ({ ...message, status: 'sent' as const })),
        ]);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить историю');
      })
      .finally(() => setIsLoadingMore(false));
  }, [chatId, isLoadingMore]);

  const deliver = useCallback(
    (localId: string, text: string) => {
      setMessages((current) =>
        current.map((message) =>
          message.localId === localId ? { ...message, status: 'sending' as const } : message,
        ),
      );

      sendMessage(chatId, { text })
        .then((saved) => {
          rememberLatest(saved.createdAt);
          setMessages((current) =>
            current.map((message) =>
              message.localId === localId ? { ...saved, status: 'sent' as const } : message,
            ),
          );
          // Список чатов держит последнее сообщение и порядок — после отправки
          // он устарел, хотя сама переписка на экране уже верна.
          void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
        })
        .catch(() => {
          // The insert policy on `messages` is what decides whether this user
          // may write here; a rejection lands the message in "failed", it is
          // never dropped silently.
          setMessages((current) =>
            current.map((message) =>
              message.localId === localId ? { ...message, status: 'failed' as const } : message,
            ),
          );
        });
    },
    [chatId, queryClient, rememberLatest],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();

      if (!trimmed) return;

      const localId = nextLocalId();

      // Shown before the server answers — this is a messenger, waiting for the
      // round trip before drawing the bubble is not an option.
      setMessages((current) => [
        {
          id: localId,
          localId,
          chatId,
          authorId: currentUserId,
          kind: 'text',
          text: trimmed,
          createdAt: new Date().toISOString(),
          attachments: [],
          status: 'sending',
        },
        ...current,
      ]);

      deliver(localId, trimmed);
    },
    [chatId, currentUserId, deliver],
  );

  const retry = useCallback(
    (localId: string) => {
      const failed = messages.find((message) => message.localId === localId);

      if (!failed?.text) return;

      deliver(localId, failed.text);
    },
    [deliver, messages],
  );

  const notifyTyping = useCallback(() => {
    if (!currentUserId) return;

    const now = Date.now();

    if (now - lastTypingSentAtRef.current < TYPING_THROTTLE_MS) return;

    lastTypingSentAtRef.current = now;
    channelRef.current?.broadcastTyping(currentUserId);
  }, [currentUserId]);

  return {
    messages,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    typingUserIds,
    loadMore,
    send,
    retry,
    notifyTyping,
  };
}
