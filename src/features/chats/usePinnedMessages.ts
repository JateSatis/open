import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import {
  listPinnedMessages,
  pinMessage,
  unpinMessage,
  type PinnedMessage,
} from '@/api/pins';
import type { Message } from '@/api/chats';
import { attachmentThumbnail } from '@/features/chats/chatDisplay';

export function pinsQueryKey(chatId: string) {
  return ['pins', chatId] as const;
}

const NO_PINS: PinnedMessage[] = [];

export type PinnedMessagesState = {
  /** От самого старого сообщения к самому новому. */
  pins: PinnedMessage[];
  isPinned: (messageId: string) => boolean;
  /** Отказ сервера откатывает закреп и пробрасывается вызвавшему — ему решать, что сказать. */
  pin: (message: Message) => Promise<void>;
  unpin: (messageId: string) => Promise<void>;
};

function byMessageTime(a: PinnedMessage, b: PinnedMessage): number {
  return a.messageCreatedAt < b.messageCreatedAt ? -1 : 1;
}

function toPinned(message: Message): PinnedMessage {
  return {
    messageId: message.id,
    messageCreatedAt: message.createdAt,
    kind: message.kind,
    text: message.text,
    thumbnailUrl: attachmentThumbnail(message.attachments),
  };
}

/**
 * Закрепы чата. Меняются сразу, до ответа сервера, и перечитываются после
 * него: список закрепов маленький, а сверить его с базой дешевле, чем
 * угадывать, что там сделал параллельно другой участник.
 */
export function usePinnedMessages(chatId: string): PinnedMessagesState {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => pinsQueryKey(chatId), [chatId]);
  const { data } = useQuery({
    queryKey,
    queryFn: () => listPinnedMessages(chatId),
  });
  const pins = data ?? NO_PINS;

  const pinnedIds = useMemo(() => new Set(pins.map((pin) => pin.messageId)), [pins]);
  const isPinned = useCallback((messageId: string) => pinnedIds.has(messageId), [pinnedIds]);

  const change = useCallback(
    async (update: (pins: PinnedMessage[]) => PinnedMessage[], request: () => Promise<void>) => {
      await queryClient.cancelQueries({ queryKey });

      const before = queryClient.getQueryData<PinnedMessage[]>(queryKey);

      queryClient.setQueryData<PinnedMessage[]>(queryKey, (current) => update(current ?? []));

      try {
        await request();
      } catch (cause) {
        queryClient.setQueryData(queryKey, before);
        throw cause;
      } finally {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    [queryClient, queryKey],
  );

  const pin = useCallback(
    (message: Message) =>
      change(
        (current) =>
          current.some((pinned) => pinned.messageId === message.id)
            ? current
            : [...current, toPinned(message)].sort(byMessageTime),
        () => pinMessage(message.id),
      ),
    [change],
  );

  const unpin = useCallback(
    (messageId: string) =>
      change(
        (current) => current.filter((pinned) => pinned.messageId !== messageId),
        () => unpinMessage(messageId),
      ),
    [change],
  );

  return { pins, isPinned, pin, unpin };
}
