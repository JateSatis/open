// Строки списка переписки. Обычное сообщение — одна строка; островок
// пересылки раскладывается на строки: плашка-заголовок и по строке на каждое
// облачко. Так островок из сотни облачков с альбомами не становится одной
// гигантской строкой: список по-прежнему виртуализирует облачка по одному,
// выбор работает с облачком, как с обычным сообщением.

import type { IslandItem } from '@/api/chats';
import type { ChatMessage } from '@/features/chats/messages/types';

export type MessageListRow = { type: 'message'; key: string; message: ChatMessage };

/** Плашка с чатом, откуда пересылали, — верх пунктирной рамки. */
export type IslandHeaderRow = { type: 'island-header'; key: string; island: ChatMessage };

/** Облачко островка — оригинал или заглушка удалённого. Последнее закрывает рамку снизу. */
export type IslandItemRow = {
  type: 'island-item';
  key: string;
  island: ChatMessage;
  item: IslandItem;
  isLast: boolean;
};

export type ChatListRow = MessageListRow | IslandHeaderRow | IslandItemRow;

/** Строка, которую можно выбрать, процитировать, переслать: облачко. */
export type BubbleRow = MessageListRow | IslandItemRow;

export function islandHeaderKey(forwardId: string): string {
  return `${forwardId}/header`;
}

/** Ключ облачка островка: один оригинал стоит в островке один раз. */
export function islandItemKey(forwardId: string, messageId: string): string {
  return `${forwardId}/${messageId}`;
}

// Строки одного сообщения живут, пока живёт само сообщение: пересборка списка
// после чужой реакции не пересоздаёт строки остальных, и список их не
// перерисовывает.
const rowsCache = new WeakMap<ChatMessage, ChatListRow[]>();

/** Строки одного сообщения — новыми вперёд, как и весь список. */
function rowsOf(message: ChatMessage): ChatListRow[] {
  const cached = rowsCache.get(message);

  if (cached) return cached;

  let rows: ChatListRow[];

  if (message.kind === 'forward' && message.forward) {
    const { items } = message.forward;

    // Список перевёрнут: нижнее облачко — первая строка, плашка — последняя.
    rows = [
      ...items
        .map(
          (item, index): IslandItemRow => ({
            type: 'island-item',
            key: islandItemKey(message.id, item.messageId),
            island: message,
            item,
            isLast: index === items.length - 1,
          }),
        )
        .reverse(),
      { type: 'island-header', key: islandHeaderKey(message.id), island: message },
    ];
  } else {
    rows = [{ type: 'message', key: message.id, message }];
  }

  rowsCache.set(message, rows);

  return rows;
}

/** Переписка строками — новыми вперёд. */
export function toChatRows(messages: ChatMessage[]): ChatListRow[] {
  return messages.flatMap(rowsOf);
}

export function isBubbleRow(row: ChatListRow): row is BubbleRow {
  return row.type !== 'island-header';
}

/** Сообщение облачка: само сообщение или оригинал в островке. Удалённый оригинал — `null`. */
export function contentOf(row: BubbleRow): ChatMessage | null {
  if (row.type === 'message') return row.message;

  return row.item.original ? originalAsMessage(row.item.original) : null;
}

/**
 * Где живут комментарии облачка и участник ли я там. У облачка островка —
 * у оригинала: в его чате и по участию в нём, а не в этом.
 */
export function commentsHomeOf(
  row: BubbleRow,
  chatId: string,
  isMember: boolean,
): { chatId: string; amMember: boolean } {
  const original = row.type === 'island-item' ? row.item.original : null;

  if (!original || original.chatId === chatId) return { chatId, amMember: isMember };

  return { chatId: original.chatId, amMember: original.chat?.amMember ?? false };
}

const asMessageCache = new WeakMap<object, ChatMessage>();

/**
 * Оригинал в виде сообщения переписки. Подтверждён сервером всегда: островок
 * ссылается только на то, что уже в базе. Один объект на оригинал — облачко
 * не перерисовывается, пока оригинал не изменился.
 */
export function originalAsMessage(original: NonNullable<IslandItem['original']>): ChatMessage {
  const cached = asMessageCache.get(original);

  if (cached) return cached;

  const message: ChatMessage = { ...original, status: 'sent' };

  asMessageCache.set(original, message);

  return message;
}

/** Островок, где стоит облачко, — для ответа и закрепа. У обычного сообщения — `null`. */
export function anchorOf(row: BubbleRow): { id: string; seq: number } | null {
  return row.type === 'island-item' ? { id: row.island.id, seq: row.island.seq } : null;
}
