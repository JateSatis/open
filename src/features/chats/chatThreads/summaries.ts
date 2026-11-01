// Сводки плашек тредов чата в кеше запросов: корень → плашка (или `null` —
// ответов, видимых мне, нет). Одна запись на чат: корни приходят пачками со
// страницами «Тредов», сигналы Realtime перечитывают только свои корни.

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import {
  listChatThreadSummaries,
  type ChatThreadPerson,
  type ChatThreadSummary,
} from '@/api/chats';
import { previewOf } from '@/features/chats/messageQuote';
import type { ChatMessage } from '@/features/chats/messages/types';
import { findOutboxMessage, outboxMessages, useOutbox, useOutboxMessages } from '@/features/chats/messages/outbox';

export type ChatThreadSummaries = Record<string, ChatThreadSummary | null>;

const NO_SUMMARIES: ChatThreadSummaries = {};
/** Столько корней за раз — потолок функции в базе. */
const MAX_ROOTS = 200;
const deferredRoots = new Map<string, Set<string>>();

export function takeDeferredChatThreadRoots(chatId: string): string[] {
  const roots = [...(deferredRoots.get(chatId) ?? [])];
  deferredRoots.delete(chatId);
  return roots;
}

export function chatThreadSummariesKey(chatId: string) {
  return ['chat-thread-summaries', chatId] as const;
}

export function readChatThreadSummaries(
  queryClient: QueryClient,
  chatId: string,
): ChatThreadSummaries | undefined {
  return queryClient.getQueryData<ChatThreadSummaries>(chatThreadSummariesKey(chatId));
}

function merge(
  queryClient: QueryClient,
  chatId: string,
  rootIds: string[],
  fresh: ChatThreadSummary[],
) {
  const byRoot = new Map(fresh.map((summary) => [summary.rootId, summary]));

  queryClient.setQueryData<ChatThreadSummaries>(chatThreadSummariesKey(chatId), (current) => {
    const next = { ...(current ?? NO_SUMMARIES) };

    rootIds.forEach((id) => {
      // HTTP-подтверждение и Broadcast приходят в любом порядке. Пока свой
      // ответ отправляется, его считает наложение outbox. Подмена базы уже
      // включающим его снимком дала бы двойную прибавку. Подтверждение/ошибка
      // отправки перечитает сводку после смены статуса.
      if (outboxMessages(chatId).some((message) => message.status === 'sending' &&
        message.chatThreadPendingAuthor && message.chatThreadRootIds?.includes(id))) {
        const deferred = deferredRoots.get(chatId) ?? new Set<string>();
        deferred.add(id);
        deferredRoots.set(chatId, deferred);
        return;
      }
      next[id] = byRoot.get(id) ?? null;
    });

    return next;
  });
}

/** Повтор входа в вид сверяет и известные корни, не только новые страницы. */
async function loadSummaries(queryClient: QueryClient, chatId: string, rootIds: string[]) {
  const ids = [...new Set([...Object.keys(readChatThreadSummaries(queryClient, chatId) ?? {}), ...rootIds])];
  await refreshChatThreadSummaries(queryClient, chatId, ids);
  return readChatThreadSummaries(queryClient, chatId) ?? NO_SUMMARIES;
}

/** Перечитать плашки этих корней. Не вышло — перечитает следующий сигнал или вход в «Треды». */
export async function refreshChatThreadSummaries(
  queryClient: QueryClient,
  chatId: string,
  rootIds: string[],
): Promise<void> {
  const unique = [...new Set(rootIds)];

  for (let start = 0; start < unique.length; start += MAX_ROOTS) {
    const batch = unique.slice(start, start + MAX_ROOTS);

    merge(queryClient, chatId, batch, await listChatThreadSummaries(batch));
  }
}

/** Корни, у которых сейчас есть плашка, — после удаления ответа их числа могли измениться. */
export function knownChatThreadRoots(queryClient: QueryClient, chatId: string): string[] {
  const summaries = readChatThreadSummaries(queryClient, chatId) ?? NO_SUMMARIES;

  return Object.keys(summaries).filter((id) => summaries[id] !== null);
}

/**
 * Мой ответ ушёл в тред — плашка меняется сразу, не дожидаясь сервера: +1,
 * я последним ответившим, мой текст. Сервер потом пришлёт настоящую.
 */
export function markPendingChatThreadReply(
  chatId: string,
  localId: string | undefined,
  rootIds: string[],
  me: ChatThreadPerson,
) {
  // Прибавка принадлежит исходящему, а не снимку сервера: сбой, удаление и
  // повтор отправки автоматически снимают/возвращают её ровно один раз.
  if (!localId) return;
  const pending = findOutboxMessage(chatId, localId);
  if (!pending || pending.status !== 'sending' || !pending.replies.some((quote) => !quote.via)) return;
  useOutbox.setState((state) => ({ byChat: { ...state.byChat,
    [chatId]: state.byChat[chatId].map((message) => message.id === pending.id
      ? { ...message, chatThreadRootIds: rootIds, chatThreadPendingAuthor: me }
      : message),
  } }));
}

/** Накладывает отправляющиеся ответы поверх неизменённого снимка сервера. */
export function withPendingChatThreadSummaries(
  summaries: ChatThreadSummaries,
  pending: ChatMessage[],
): ChatThreadSummaries {
  const sending = pending.filter((message) => message.status === 'sending' && message.chatThreadPendingAuthor);
  if (sending.length === 0) return summaries;
  const next = { ...summaries };
  for (const message of [...sending].reverse()) {
    const me = message.chatThreadPendingAuthor!;
    const preview = previewOf(message);

    (message.chatThreadRootIds ?? []).forEach((rootId) => {
      const known = next[rootId];
      const others = (known?.people ?? []).filter((person) => person.id !== me.id);
      const wasShown = known?.viewerReplied || (known?.people ?? []).some((person) => person.id === me.id);
      const total = (known?.people.length ?? 0) + (known?.othersCount ?? 0) + (wasShown ? 0 : 1);
      const people = [me, ...others].slice(0, 2);

      next[rootId] = {
        rootId,
        repliesCount: (known?.repliesCount ?? 0) + 1,
        last: { seq: known?.last?.seq ?? 0, createdAt: message.createdAt, preview },
        people,
        othersCount: Math.max(total - people.length, 0),
        viewerReplied: true,
      };
    });
  }
  return next;
}

/**
 * Плашки корней `rootIds` для экрана: незнакомые корни дочитываются пачкой.
 * Пока плашки нет — `undefined` у корня.
 */
export function useChatThreadSummaries(
  chatId: string,
  rootIds: string[],
  enabled: boolean,
): ChatThreadSummaries {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: chatThreadSummariesKey(chatId),
    queryFn: () => loadSummaries(queryClient, chatId, rootIds),
    staleTime: 0,
    enabled,
  });
  const summaries = data ?? NO_SUMMARIES;
  const pending = useOutboxMessages(chatId);
  const missing = useMemo(
    () => (enabled ? rootIds.filter((id) => !(id in summaries)) : []),
    [enabled, rootIds, summaries],
  );
  const missingKey = missing.join(',');

  useEffect(() => {
    if (missing.length === 0) return;

    refreshChatThreadSummaries(queryClient, chatId, missing).catch(() => undefined);
    // Дочитывать по составу, а не по каждой новой ссылке на массив.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, missingKey, queryClient]);

  return useMemo(() => withPendingChatThreadSummaries(summaries, pending), [pending, summaries]);
}
