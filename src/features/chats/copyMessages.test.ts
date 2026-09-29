import { formatMessagesForCopy } from './copyMessages';

import type { ChatMessage } from '@/features/chats/messages/types';

function message(id: string, text: string | null, authorId: string, createdAt: string): ChatMessage {
  return {
    id,
    chatId: 'chat-1',
    authorId,
    kind: text === null ? 'voice' : 'text',
    text,
    createdAt,
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    status: 'sent',
  };
}

const names: Record<string, string> = { 'user-1': 'Я', 'user-2': 'Марина' };
const nameOf = (authorId: string | null) => (authorId ? names[authorId] : 'Удалённый аккаунт');

// Время в тестах — локальное, как его и показывает приложение.
const at = (hours: number, minutes: number) => new Date(2026, 8, 27, hours, minutes).toISOString();

describe('formatMessagesForCopy', () => {
  it('copies a single message as its bare text', () => {
    expect(formatMessagesForCopy([message('a', 'привет', 'user-2', at(10, 0))], nameOf)).toBe(
      'привет',
    );
  });

  it('glues several messages in chat order with author and time, like Telegram', () => {
    // Выбор идёт в любом порядке — в буфер сообщения ложатся по времени.
    const selected = [
      message('b', 'как дела?', 'user-1', at(10, 5)),
      message('a', 'привет', 'user-2', at(10, 0)),
    ];

    expect(formatMessagesForCopy(selected, nameOf)).toBe(
      'Марина, [27.09.2026 10:00]\nпривет\n\nЯ, [27.09.2026 10:05]\nкак дела?',
    );
  });

  it('skips messages without text', () => {
    const selected = [
      message('a', 'привет', 'user-2', at(10, 0)),
      message('b', null, 'user-2', at(10, 1)),
      message('c', 'пока', 'user-1', at(10, 2)),
    ];

    expect(formatMessagesForCopy(selected, nameOf)).toBe(
      'Марина, [27.09.2026 10:00]\nпривет\n\nЯ, [27.09.2026 10:02]\nпока',
    );
  });
});
