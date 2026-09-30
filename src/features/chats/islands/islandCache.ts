// Оригиналы в островках, как они лежат в кеше истории. Одно сообщение может
// жить сразу в нескольких местах кеша: в истории своего чата и в островках
// других чатов. Всё, что меняет оригинал — правка, удаление, реакции, число
// комментариев, — меняет его во всех этих местах сразу.

import type { IslandItem, IslandOriginal, Message } from '@/api/chats';
import type { ChatMessage } from '@/features/chats/messages/types';

type OriginalUpdate = (original: IslandOriginal) => IslandOriginal | null;

/**
 * Применяет `update` к каждому живому оригиналу островка. Островок и позиции,
 * которых изменение не коснулось, остаются теми же объектами — список их не
 * перерисовывает.
 */
export function mapOriginals(message: ChatMessage, update: OriginalUpdate): ChatMessage {
  if (message.kind !== 'forward' || !message.forward) return message;

  let changed = false;

  const items = message.forward.items.map((item): IslandItem => {
    if (!item.original) return item;

    const next = update(item.original);

    if (next === item.original) return item;

    changed = true;
    return { ...item, original: next };
  });

  return changed ? { ...message, forward: { ...message.forward, items } } : message;
}

/** id живых оригиналов во всех загруженных островках. */
export function originalIds(messages: readonly ChatMessage[]): string[] {
  const ids = new Set<string>();

  for (const message of messages) {
    for (const item of message.forward?.items ?? []) {
      if (item.original) ids.add(item.original.id);
    }
  }

  return [...ids];
}

/** Оригиналы по id — из загруженных островков. */
export function findOriginals(
  messages: readonly ChatMessage[],
  ids: ReadonlySet<string>,
): IslandOriginal[] {
  const found = new Map<string, IslandOriginal>();

  for (const message of messages) {
    for (const item of message.forward?.items ?? []) {
      if (item.original && ids.has(item.original.id)) found.set(item.original.id, item.original);
    }
  }

  return [...found.values()];
}

/**
 * Свежая версия оригинала поверх той, что в островке. Автор и чат
 * оригинала — из островка: выборка сообщения по id их не несёт, а за время
 * правки они не меняются.
 */
export function withFreshContent(original: IslandOriginal, fresh: Message): IslandOriginal {
  return {
    ...original,
    kind: fresh.kind,
    text: fresh.text,
    editedAt: fresh.editedAt,
    attachments: fresh.attachments,
    replies: fresh.replies,
    reactions: fresh.reactions,
    commentsCount: fresh.commentsCount,
  };
}

/** Островок без этих оригиналов — переславший убрал их. Пустой островок исчезает. */
export function withoutItems(
  message: ChatMessage,
  messageIds: ReadonlySet<string>,
): ChatMessage | null {
  if (message.kind !== 'forward' || !message.forward) return message;

  const items = message.forward.items.filter((item) => !messageIds.has(item.messageId));

  if (items.length === message.forward.items.length) return message;
  if (items.length === 0) return null;

  return { ...message, forward: { ...message.forward, items } };
}
