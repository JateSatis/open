import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import type { ChatThreadSummary } from '@/api/chats';
import {
  chatThreadQueryKey,
  loadChatThread,
  loadChatThreadGap,
  readChatThread,
} from '@/features/chats/chatThreads/threadCache';
import { chatThreadRootsOf } from '@/features/chats/chatThreads/useChatThreadReplies';
import type { ChatListRow, MessageListRow } from '@/features/chats/islands/rows';
import { useOutboxMessages } from '@/features/chats/messages/outbox';
import type { ChatMessage } from '@/features/chats/messages/types';
import { loadStateOf } from '@/lib/loadState';

/** Строка шторки: облачко, разрыв «показать ещё» или загрузка. */
export type ChatThreadPaneRow =
  | (MessageListRow & { chatThreadRoot: boolean })
  | { type: 'chat-thread-gap'; key: string; hidden: number }
  | { type: 'chat-thread-loading'; key: string; failed: boolean };

const NO_MESSAGES: ChatMessage[] = [];

/**
 * Облачко ответа в шторке: цитаты — только на сообщения этого треда, кроме
 * корня (на него ответ здесь подразумевается). Цитаты вне треда не
 * показываются: ответ на два треда в шторке первого не цитирует второй.
 */
export function withThreadQuotes(
  message: ChatMessage,
  rootId: string,
  quotes: Record<string, string[]> | undefined,
  inThread: ReadonlySet<string>,
): ChatMessage {
  if (message.replies.length === 0) return message;

  const known = quotes?.[message.id];
  const keep = known
    ? new Set(known)
    : new Set(
        message.replies
          .filter((quote) => quote.messageId !== rootId && !quote.via && inThread.has(quote.messageId))
          .map((quote) => quote.messageId),
      );
  const replies = message.replies.filter((quote) => keep.has(quote.messageId));

  return replies.length === message.replies.length ? message : { ...message, replies };
}

/**
 * Тред в шторке: корень сверху, ответы по порядку, разрыв длинного треда и
 * мои неотправленные ответы в этот тред в конце.
 */
export function useChatThreadPane(chatId: string, rootId: string, summary: ChatThreadSummary | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: chatThreadQueryKey(chatId, rootId),
    queryFn: () => loadChatThread(queryClient, chatId, rootId),
    refetchOnReconnect: false,
  });
  const state = loadStateOf(query);
  const outbox = useOutboxMessages(chatId);
  const [loadingGap, setLoadingGap] = useState(false);
  const thread = query.data;
  const items = thread?.items ?? NO_MESSAGES;

  const pending = useMemo(
    () =>
      outbox.filter(
        (message) =>
          message.status !== 'sent' &&
          message.replies.length > 0 &&
          chatThreadRootsOf(queryClient, message.replies.flatMap((q) => (q.state === 'live' ? [q] : []))).includes(rootId),
      ),
    [outbox, queryClient, rootId],
  );

  const rows = useMemo((): ChatThreadPaneRow[] => {
    const inThread = new Set(items.map((message) => message.id));
    const chronological = [...items].reverse();
    const root = chronological.find((message) => message.id === rootId) ?? null;
    const replies = chronological.filter((message) => message.id !== rootId);
    const toRow = (message: ChatMessage, isRoot: boolean): ChatThreadPaneRow => ({
      type: 'message',
      key: message.id,
      message: isRoot ? message : withThreadQuotes(message, rootId, thread?.quotes, inThread),
      chatThreadRoot: isRoot,
    });
    const result: ChatThreadPaneRow[] = [];

    if (root) result.push(toRow(root, true));

    if (!thread) {
      result.push({ type: 'chat-thread-loading', key: `${rootId}/loading`, failed: state === 'failed' });
      return result;
    }

    const gap = thread.gap;

    for (const reply of replies) {
      if (gap && reply.seq >= gap.beforeSeq && !result.some((row) => row.type === 'chat-thread-gap')) {
        const loaded = replies.length;

        result.push({
          type: 'chat-thread-gap',
          key: `${rootId}/gap`,
          // Число на плашке может отставать от загруженного — «ещё» всегда хоть один.
          hidden: Math.max(1, (summary?.repliesCount ?? 0) - loaded),
        });
      }

      result.push(toRow(reply, false));
    }

    const known = new Set(result.map((row) => row.key));

    pending
      .filter((message) => !known.has(message.id))
      .reverse()
      .forEach((message) => result.push(toRow(message, false)));

    return result;
  }, [items, pending, rootId, state, summary, thread]);

  /** Строки облачков новыми вперёд — для выбора: он считает порядок от перевёрнутого списка. */
  const bubbleRows = useMemo(
    () =>
      rows
        .filter((row): row is ChatThreadPaneRow & MessageListRow => row.type === 'message')
        .map((row): ChatListRow => row)
        .reverse(),
    [rows],
  );

  const loadGap = useCallback(async () => {
    setLoadingGap(true);

    try {
      await loadChatThreadGap(queryClient, chatId, rootId);
    } finally {
      setLoadingGap(false);
    }
  }, [chatId, queryClient, rootId]);

  /** Догружает разрыв, пока в треде не окажется сообщение с этим номером. */
  const loadUntil = useCallback(
    async (seq: number): Promise<boolean> => {
      for (;;) {
        const current = readChatThread(queryClient, chatId, rootId);

        if (!current) return false;
        if (current.items.some((message) => message.seq === seq)) return true;
        if (!current.gap || seq <= current.gap.afterSeq || seq >= current.gap.beforeSeq) {
          return current.items.some((message) => message.seq === seq);
        }

        const before = current.gap.afterSeq;

        await loadChatThreadGap(queryClient, chatId, rootId);

        if (readChatThread(queryClient, chatId, rootId)?.gap?.afterSeq === before) return false;
      }
    },
    [chatId, queryClient, rootId],
  );

  const retry = useCallback(() => void query.refetch(), [query]);

  return {
    rows,
    bubbleRows,
    root: items.find((message) => message.id === rootId) ?? null,
    newestReply: items.find((message) => message.id !== rootId) ?? null,
    isLoading: !thread,
    loadingGap,
    loadGap,
    loadUntil,
    retry,
  };
}
