import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  listMessages,
  listMessagesSince,
  sendMessage,
  subscribeToChat,
  type ChatChannel,
  type Message,
  type MessageAttachment,
  type SendMessageMedia,
} from '@/api/chats';
import { chatQueryKey } from '@/features/chats/useChat';
import { reportRequestFailed } from '@/features/connection/connectionStore';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import {
  libraryAssetToLocalMedia,
  removeUploadedMedia,
  uploadAllMedia,
  type LibraryAsset,
  type UploadedMedia,
} from '@/features/media';
import { describeLoadError, isNetworkError } from '@/lib/network';
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
  /** Исходный выбор из галереи — нужен только для повтора неудачной отправки. */
  pendingMedia?: LibraryAsset[];
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
  send: (text: string, media?: LibraryAsset[]) => void;
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

/** Локальный предпросмотр вложения до ответа сервера — облачко не пустует, пока файлы грузятся. */
function toLocalAttachment(asset: LibraryAsset): MessageAttachment {
  return {
    id: asset.id,
    url: asset.uri,
    mimeType: asset.kind === 'video' ? 'video/mp4' : 'image/jpeg',
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
  };
}

function toSendMedia(item: UploadedMedia): SendMessageMedia {
  return {
    url: item.url,
    mimeType: item.mimeType,
    width: item.width,
    height: item.height,
    durationMs: item.durationMs,
    sizeBytes: item.sizeBytes,
  };
}

export function useChatMessages(chatId: string, currentUserId: string | null): ChatMessagesState {
  const queryClient = useQueryClient();
  const connection = useConnectionStatus();
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
  // Неотправленное держим отдельно от рендера: повтор запускается по событию
  // связи, а не по перерисовке списка.
  const unsentRef = useRef<{ localId: string; text: string; media: LibraryAsset[] }[]>([]);
  const wasOfflineRef = useRef(false);
  // Связь может мигать чаще, чем успевает отработать одна отправка (особенно
  // с медиа — загрузка файлов идёт заметно дольше вставки текста), и тогда
  // повтор по «связь вернулась» стартовал бы поверх ещё не завершившейся
  // попытки той же локальной записи — сообщение ушло бы в чат дважды.
  const deliveringRef = useRef(new Set<string>());

  const rememberLatest = useCallback((createdAt: string) => {
    if (!latestServerAtRef.current || createdAt > latestServerAtRef.current) {
      latestServerAtRef.current = createdAt;
    }
  }, []);

  const pullNewMessages = useCallback(async () => {
    const since = latestServerAtRef.current;

    try {
      // В пустом чате отметки «докуда прочитано» ещё нет, и дочитывать не от
      // чего — первое сообщение забираем обычной страницей, иначе диалог
      // оживает только после повторного входа.
      const incoming = since
        ? await listMessagesSince(chatId, since)
        : [...(await listMessages(chatId)).items].reverse();

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

        setError(describeLoadError(cause, 'Не удалось загрузить сообщения'));
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
      onReconnected: () => {
        // Пока канала не было, события терялись: и новые сообщения, и чужие
        // отметки прочтения. Забираем и то, и другое.
        void pullNewMessages();
        void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
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

  useEffect(() => {
    unsentRef.current = messages.flatMap((message) =>
      message.status === 'failed' && message.localId
        ? [{ localId: message.localId, text: message.text ?? '', media: message.pendingMedia ?? [] }]
        : [],
    );
  }, [messages]);

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
        setError(describeLoadError(cause, 'Не удалось загрузить историю'));
      })
      .finally(() => setIsLoadingMore(false));
  }, [chatId, isLoadingMore]);

  const deliver = useCallback(
    async (localId: string, text: string, media: LibraryAsset[]) => {
      if (deliveringRef.current.has(localId)) return;

      deliveringRef.current.add(localId);

      setMessages((current) =>
        current.map((message) =>
          message.localId === localId ? { ...message, status: 'sending' as const } : message,
        ),
      );

      let uploaded: UploadedMedia[] = [];

      try {
        if (media.length > 0) {
          // Без своего id файлы заливать некуда (путь в Storage строится от
          // него) — явный сбой лучше, чем сообщение, которое молча
          // потеряло вложения по дороге.
          if (!currentUserId) throw new Error('Нет активной сессии');

          uploaded = await uploadAllMedia(media.map(libraryAssetToLocalMedia), currentUserId);
        }

        const saved = await sendMessage(chatId, {
          text: text || undefined,
          media: uploaded.length > 0 ? uploaded.map(toSendMedia) : undefined,
        });

        rememberLatest(saved.createdAt);
        setMessages((current) =>
          current.map((message) =>
            message.localId === localId
              ? { ...saved, status: 'sent' as const, pendingMedia: undefined }
              : message,
          ),
        );
        // Список чатов держит последнее сообщение и порядок — после отправки
        // он устарел, хотя сама переписка на экране уже верна.
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      } catch (cause) {
        // Сообщение в базу не попало (или упало на середине) — загруженные
        // файлы теперь ничьи, оставлять их в Storage незачем.
        if (uploaded.length > 0) {
          void Promise.all(uploaded.map((item) => removeUploadedMedia(item.path)));
        }

        // Не дошло до сервера — это факт о связи, а не только об этом
        // сообщении: с него и начинается ожидание сети.
        if (isNetworkError(cause)) reportRequestFailed();

        // The insert policy on `messages` is what decides whether this user
        // may write here; a rejection lands the message in "failed", it is
        // never dropped silently.
        setMessages((current) =>
          current.map((message) =>
            message.localId === localId ? { ...message, status: 'failed' as const } : message,
          ),
        );
      } finally {
        deliveringRef.current.delete(localId);
      }
    },
    [chatId, currentUserId, queryClient, rememberLatest],
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
    for (const unsent of unsentRef.current) {
      void deliver(unsent.localId, unsent.text, unsent.media);
    }
  }, [connection, deliver]);

  const send = useCallback(
    (text: string, media: LibraryAsset[] = []) => {
      const trimmed = text.trim();

      if (!trimmed && media.length === 0) return;

      const localId = nextLocalId();

      // Shown before the server answers — this is a messenger, waiting for the
      // round trip before drawing the bubble is not an option.
      setMessages((current) => [
        {
          id: localId,
          localId,
          chatId,
          authorId: currentUserId,
          kind: media.length > 0 ? 'media' : 'text',
          text: trimmed || null,
          createdAt: new Date().toISOString(),
          attachments: media.map(toLocalAttachment),
          pendingMedia: media.length > 0 ? media : undefined,
          status: 'sending',
        },
        ...current,
      ]);

      void deliver(localId, trimmed, media);
    },
    [chatId, currentUserId, deliver],
  );

  const retry = useCallback(
    (localId: string) => {
      const failed = messages.find((message) => message.localId === localId);

      if (!failed) return;
      if (!failed.text && !failed.pendingMedia?.length) return;

      void deliver(localId, failed.text ?? '', failed.pendingMedia ?? []);
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
