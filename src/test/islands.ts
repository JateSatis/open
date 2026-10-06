// Островки пересылки для тестов: оригинал с автором и чатом и островок,
// собранный из оригиналов, — в том виде, в каком их отдаёт `toMessage`.

import type { ChatRef, IslandOriginal, Message } from '@/api/chats';

const NO_REACTIONS = { members: {}, visitors: {}, mine: null };

type OriginalInput = Partial<IslandOriginal> & { id: string };

/** Оригинал: обычное сообщение другого (или этого) чата с автором и чатом. */
export function original({ id, ...overrides }: OriginalInput): IslandOriginal {
  return {
    id,
    chatId: 'chat-src',
    authorId: 'user-9',
    kind: 'text',
    text: `оригинал ${id}`,
    createdAt: '2026-09-01T10:00:00Z',
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    authorName: 'Джиган',
    authorAvatarUrl: null,
    chat: { id: 'chat-src', name: 'Джиган и Самойлова', readUpTo: null, amMember: false },
    ...overrides,
  };
}

/**
 * Островок: оригиналы по порядку, `null` — удалённый оригинал (заглушка;
 * его id — `deleted-<позиция>`).
 */
export function island(
  id: string,
  createdAt: string,
  originals: (IslandOriginal | null)[],
  options: { chatId?: string; authorId?: string; sourceChat?: ChatRef | null } = {},
): Message {
  return {
    id,
    chatId: options.chatId ?? 'chat-1',
    authorId: options.authorId ?? 'user-2',
    kind: 'forward',
    text: null,
    createdAt,
    editedAt: null,
    attachments: [],
    replies: [],
    forward: {
      sourceChat:
        options.sourceChat === undefined
          ? { id: 'chat-src', name: 'Джиган и Самойлова' }
          : options.sourceChat,
      items: originals.map((item, position) => ({
        id: `${id}-item-${position}`,
        position,
        messageId: item?.id ?? `deleted-${position}`,
        original: item,
      })),
    },
    reactions: NO_REACTIONS,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
  };
}
