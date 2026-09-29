import { quotedIds, removeMessages, type ChatHistory } from './historyCache';

import type { ChatMessage } from '@/features/chats/messages/types';

function message(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    chatId: 'chat-1',
    authorId: 'user-1',
    kind: 'text',
    text: id,
    createdAt: '2026-09-29T10:00:00Z',
    attachments: [],
    replies: [],
    forward: null,
    status: 'sent',
    ...overrides,
  };
}

const liveQuote = (messageId: string) => ({
  messageId,
  state: 'live' as const,
  authorId: 'user-2',
  authorName: 'Марина',
  createdAt: '2026-09-29T09:00:00Z',
  preview: {
    kind: 'text' as const,
    text: 'оригинал',
    thumbnailUrl: null,
    mediaCount: 0,
    firstMediaIsVideo: false,
    durationMs: null,
  },
});

describe('removeMessages', () => {
  it('turns a quote of a deleted message into «deleted», keeping the reply itself', () => {
    const history: ChatHistory = {
      items: [message('reply', { replies: [liveQuote('gone'), liveQuote('kept')] }), message('gone')],
      nextCursor: null,
    };

    const next = removeMessages(history, new Set(['gone']));

    expect(next.items.map((item) => item.id)).toEqual(['reply']);
    expect(next.items[0].replies).toEqual([
      { messageId: 'gone', state: 'deleted' },
      liveQuote('kept'),
    ]);
  });

  it('leaves the history untouched when nothing it shows was deleted', () => {
    const history: ChatHistory = { items: [message('a')], nextCursor: null };

    expect(removeMessages(history, new Set(['elsewhere']))).toBe(history);
  });
});

describe('quotedIds', () => {
  it('lists live quotes even when their messages are not loaded', () => {
    const history: ChatHistory = {
      items: [message('reply', { replies: [liveQuote('old'), { messageId: 'x', state: 'deleted' }] })],
      nextCursor: 'cursor',
    };

    expect(quotedIds(history)).toEqual(['old']);
  });
});
