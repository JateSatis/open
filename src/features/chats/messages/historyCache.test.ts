import {
  knownEdits,
  quotedIds,
  removeMessages,
  replaceMessages,
  type ChatHistory,
} from './historyCache';

import type { ChatMessage } from '@/features/chats/messages/types';

function message(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    chatId: 'chat-1',
    authorId: 'user-1',
    kind: 'text',
    text: id,
    createdAt: '2026-09-29T10:00:00Z',
    editedAt: null,
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
  editedAt: null,
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

describe('replaceMessages', () => {
  it('puts the edited version in place and refreshes its quotes, keeping the order', () => {
    const history: ChatHistory = {
      items: [message('reply', { replies: [liveQuote('orig')] }), message('orig', { text: 'было' })],
      nextCursor: null,
    };
    const edited = { ...message('orig', { text: 'стало' }), editedAt: '2026-09-29T11:00:00Z' };

    const next = replaceMessages(history, [edited]);

    expect(next.items.map((item) => item.id)).toEqual(['reply', 'orig']);
    expect(next.items[1]).toMatchObject({ text: 'стало', editedAt: '2026-09-29T11:00:00Z' });
    expect(next.items[0].replies[0]).toMatchObject({
      state: 'live',
      editedAt: '2026-09-29T11:00:00Z',
      preview: { text: 'стало' },
    });
  });

  it('refreshes a quote even when its message is not loaded, without adding it', () => {
    const history: ChatHistory = {
      items: [message('reply', { replies: [liveQuote('far')] })],
      nextCursor: 'cursor',
    };

    const next = replaceMessages(history, [message('far', { text: 'далеко, но свежее' })]);

    expect(next.items).toHaveLength(1);
    expect(next.items[0].replies[0]).toMatchObject({ preview: { text: 'далеко, но свежее' } });
  });

  it('leaves the history untouched when nothing it shows was edited', () => {
    const history: ChatHistory = { items: [message('a')], nextCursor: null };

    expect(replaceMessages(history, [message('elsewhere')])).toBe(history);
  });
});

describe('knownEdits', () => {
  it('knows the edit time of loaded messages and of quoted ones', () => {
    const quote = { ...liveQuote('far'), editedAt: '2026-09-29T08:00:00Z' };
    const history: ChatHistory = {
      items: [message('a', { editedAt: '2026-09-29T09:00:00Z', replies: [quote] })],
      nextCursor: null,
    };

    expect(knownEdits(history)).toEqual(
      new Map([
        ['a', '2026-09-29T09:00:00Z'],
        ['far', '2026-09-29T08:00:00Z'],
      ]),
    );
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
