// Загруженная история чата в кеше TanStack Query: самые новые первыми, плюс
// курсор к следующей странице назад. Всё, что меняет историю, — первая
// страница, догрузка, Realtime, удаление, подтверждённая отправка — пишет
// сюда функциональным обновлением, поэтому одновременные изменения не
// затирают друг друга.
//
// Страницы не хранятся по отдельности намеренно: `useInfiniteQuery` склеивает
// догруженную страницу со страницами, какими они были в начале запроса, и
// тем самым выбрасывает всё, что пришло в кеш за время догрузки.

import type { QueryClient } from '@tanstack/react-query';

import type { Message } from '@/api/chats';
import type { ChatMessage } from '@/features/chats/messages/types';

export type ChatHistory = {
  /** Newest first — the list that renders them is inverted. */
  items: ChatMessage[];
  /** `createdAt` самого старого загруженного, пока глубже есть что грузить. */
  nextCursor: string | null;
};

export function messagesQueryKey(chatId: string) {
  return ['messages', chatId] as const;
}

export function toSent(message: Message): ChatMessage {
  return { ...message, status: 'sent' };
}

function byNewest(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt === b.createdAt) return 0;

  return a.createdAt > b.createdAt ? -1 : 1;
}

/**
 * Вливает сообщения в историю: уже известные остаются как есть (у своего
 * отправленного там локальные превью), новые встают по времени.
 *
 * `newer` — пришедшее после загруженного, в порядке от старого к новому
 * (так его отдаёт дочитывание); `older` — страница назад, от нового к старому.
 * При равном времени новое встаёт над известным, старое — под ним.
 */
export function mergeMessages(
  history: ChatHistory,
  incoming: Message[],
  direction: 'newer' | 'older',
): ChatHistory {
  const known = new Set(history.items.map((message) => message.id));
  const added = incoming.filter((message) => !known.has(message.id)).map(toSent);

  if (added.length === 0) return history;

  const items =
    direction === 'newer' ? [...added.reverse(), ...history.items] : [...history.items, ...added];

  return { ...history, items: items.sort(byNewest) };
}

export function removeMessages(history: ChatHistory, ids: ReadonlySet<string>): ChatHistory {
  const items = history.items.filter((message) => !ids.has(message.id));

  return items.length === history.items.length ? history : { ...history, items };
}

/** Возвращает на место сообщения, которые сервер отказался удалять. */
export function restoreMessages(history: ChatHistory, messages: ChatMessage[]): ChatHistory {
  const known = new Set(history.items.map((message) => message.id));
  const missing = messages.filter((message) => !known.has(message.id));

  if (missing.length === 0) return history;

  return { ...history, items: [...history.items, ...missing].sort(byNewest) };
}

export function readHistory(queryClient: QueryClient, chatId: string): ChatHistory | undefined {
  return queryClient.getQueryData<ChatHistory>(messagesQueryKey(chatId));
}

/**
 * Меняет историю, если она загружена. Незагруженную не создаёт: пустая
 * история с `nextCursor: null` соврала бы экрану, что сообщений нет вовсе.
 */
export function updateHistory(
  queryClient: QueryClient,
  chatId: string,
  update: (history: ChatHistory) => ChatHistory,
) {
  queryClient.setQueryData<ChatHistory>(messagesQueryKey(chatId), (history) =>
    history ? update(history) : history,
  );
}
