import {
  knownEdits,
  patchReactions,
  patchViews,
  quotedIds,
  removeMessages,
  replaceMessages,
  type ChatHistory,
} from './historyCache';

import type { ChatMessage } from '@/features/chats/messages/types';
import { island, original } from '@/test/islands';

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
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
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

describe('patchReactions', () => {
  const history: ChatHistory = { items: [message('m2'), message('m1')], nextCursor: null };

  it('puts fresh counters on loaded messages and leaves the rest as they were', () => {
    const fresh = { members: { '👍': 3 }, visitors: { '🔥': 1 }, mine: null };
    const next = patchReactions(history, [
      { id: 'm1', reactions: fresh },
      { id: 'not-loaded', reactions: fresh },
    ]);

    expect(next.items[1].reactions).toEqual(fresh);
    expect(next.items[0]).toBe(history.items[0]);
    expect(next.items).toHaveLength(2);
  });

  it('keeps the same history when nothing changed, so the list does not redraw', () => {
    expect(
      patchReactions(history, [{ id: 'm1', reactions: { members: {}, visitors: {}, mine: null } }]),
    ).toBe(history);
  });
});

describe('patchViews', () => {
  it('кладёт просмотры и «прочитано» сообщению и оригиналу в островке', () => {
    const history: ChatHistory = {
      items: [
        message('m1'),
        { ...island('f1', '2026-09-29T11:00:00Z', [original({ id: 'o1' })]), status: 'sent' },
      ],
      nextCursor: null,
    };

    const next = patchViews(history, [
      { id: 'm1', viewsCount: 3, readAt: '2026-09-29T12:00:00Z' },
      { id: 'o1', viewsCount: 7, readAt: null },
    ]);

    expect(next.items[0]).toMatchObject({ viewsCount: 3, readAt: '2026-09-29T12:00:00Z' });
    expect(next.items[1].forward?.items[0].original).toMatchObject({ viewsCount: 7 });
  });

  it('без изменений отдаёт ту же историю — список не перерисовывается', () => {
    const history: ChatHistory = { items: [message('m1')], nextCursor: null };

    expect(patchViews(history, [{ id: 'm1', viewsCount: 0, readAt: null }])).toBe(history);
  });
});
