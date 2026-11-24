// Как «Треды» догоняют базу по сигналам чата. Переписка дочитывается как
// обычно (`messages/sync.ts`); здесь — то, что это значит для тредов: лента
// «Тредов» дочитывает свои не-ответы, плашки — корни пришедших ответов,
// открытая шторка — свои новые ответы.

import { requestClient } from '@/api/requestClient';
import type { QueryClient } from '@tanstack/react-query';

import { deletedChatThreadRoot } from '@/api/chats';
import type { Message } from '@/api/chats';
import { openedChatThread } from '@/features/chats/chatThreads/chatThreadPanelStore';
import {
  knownChatThreadRoots,
  readChatThreadSummaries,
  refreshChatThreadSummaries,
} from '@/features/chats/chatThreads/summaries';
import { pullChatThread } from '@/features/chats/chatThreads/chatThreadCache';
import {
  mergeMessages,
  readAllHistories,
  readHistory,
  updateHistory,
} from '@/features/chats/messages/historyCache';
import { pullNewMessages } from '@/features/chats/messages/sync';

/** Корни тредов этих сообщений. */
export function rootsOf(messages: Pick<Message, 'chatThreadRootIds'>[]): string[] {
  return [...new Set(messages.flatMap((message) => message.chatThreadRootIds ?? []))];
}

/**
 * В чат пришли сообщения (`incoming` — то, что дочитала переписка). Лента
 * «Тредов» дочитывает своё сама: в ней нет ответов, и её край — свой.
 */
export async function pullChatThreads(
  queryClient: QueryClient,
  chatId: string,
  incoming: Message[],
  api = requestClient(),
): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  const roots = rootsOf(incoming);
  const pane = openedChatThread();

  if (readHistory(queryClient, chatId, 'chat-threads')) {
    tasks.push(pullNewMessages(queryClient, chatId, 'chat-threads', api));
  }

  if (roots.length > 0 && readChatThreadSummaries(queryClient, chatId)) {
    tasks.push(refreshChatThreadSummaries(queryClient, chatId, roots, api));
  }

  // Шторка дочитывает и без известных корней: переписка могла дочитать не всё.
  if (pane?.chatId === chatId) tasks.push(pullChatThread(queryClient, chatId, pane.rootId, api));

  await Promise.all(tasks);
}

/**
 * Сообщения удалили или поправили: числа и превью плашек могли измениться.
 * Корни удалённого ответа уже не узнать — он ушёл из истории, — поэтому
 * перечитываются все известные плашки.
 */
export async function refreshChatThreadsAfterChange(
  queryClient: QueryClient,
  chatId: string,
  messageIds: string[],
  api = requestClient(),
): Promise<void> {
  if (!readChatThreadSummaries(queryClient, chatId)) return;

  const ids = new Set(messageIds);
  const changed = readAllHistories(queryClient)
    .flatMap((history) => history.items)
    .filter((message) => ids.has(message.id));
  const roots = changed.length > 0 ? rootsOf(changed) : knownChatThreadRoots(queryClient, chatId);

  if (roots.length > 0) await refreshChatThreadSummaries(queryClient, chatId, roots, api);
}

/** После обрыва: все известные плашки — заново. */
export async function refreshAllChatThreadSummaries(
  queryClient: QueryClient,
  chatId: string,
  api = requestClient(),
): Promise<void> {
  const known = readChatThreadSummaries(queryClient, chatId);

  if (!known) return;

  await refreshChatThreadSummaries(queryClient, chatId, Object.keys(known), api);
}

/** Сообщения ленты «Тредов» с этими id — снимок до удаления. */
export function chatThreadFeedItems(
  queryClient: QueryClient,
  chatId: string,
  messageIds: Iterable<string>,
): Message[] {
  const ids = new Set(messageIds);

  return readHistory(queryClient, chatId, 'chat-threads')?.items.filter((m) => ids.has(m.id)) ?? [];
}

/**
 * Удалённое исходное сообщение с ответами остаётся в «Тредах» заглушкой
 * «Сообщение удалено» с плашкой — как удалённый корень в комментариях.
 */
export function keepDeletedChatThreadRoots(
  queryClient: QueryClient,
  chatId: string,
  removed: Message[],
) {
  const summaries = readChatThreadSummaries(queryClient, chatId) ?? {};
  const stubs = removed
    .filter((message) => (summaries[message.id]?.repliesCount ?? 0) > 0)
    .map((message) => deletedChatThreadRoot(chatId, message.id, message.seq));

  if (stubs.length === 0) return;

  updateHistory(
    queryClient,
    chatId,
    (history) => mergeMessages(history, stubs, 'older'),
    'chat-threads',
  );
}
