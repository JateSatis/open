import { canEnterFragmentMode, hasClusters, hasSelectableText } from './fragmentRules';

import type { ChatMessage } from '@/features/chats/messages/types';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    chatId: 'chat-1',
    authorId: 'user-2',
    kind: 'text',
    text: 'какой-то другой уровень',
    createdAt: '2026-10-14T10:00:00Z',
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
  } as ChatMessage;
}

describe('selectable text', () => {
  it('is in a sent text message, a caption and a text under a voice', () => {
    expect(hasSelectableText(message())).toBe(true);
    expect(hasSelectableText(message({ kind: 'media' }))).toBe(true);
    expect(hasSelectableText(message({ kind: 'voice' }))).toBe(true);
  });

  it('is not in a photo without a caption, a system line, an island or a forwarded comment', () => {
    expect(hasSelectableText(message({ kind: 'media', text: null }))).toBe(false);
    expect(hasSelectableText(message({ text: '   ' }))).toBe(false);
    expect(hasSelectableText(message({ kind: 'system' }))).toBe(false);
    expect(hasSelectableText(message({ kind: 'forward' }))).toBe(false);
    expect(hasSelectableText(message({ kind: 'comment_forward' }))).toBe(false);
  });

  it('is not in a message the server has not confirmed', () => {
    expect(hasSelectableText(message({ status: 'sending' } as Partial<ChatMessage>))).toBe(false);
    expect(hasSelectableText(message({ status: 'failed' } as Partial<ChatMessage>))).toBe(false);
  });
});

describe('who enters the fragment mode by a tap', () => {
  it('lets a viewer in on any message with text', () => {
    expect(
      canEnterFragmentMode({ message: message(), isViewer: true, hasVisibleCluster: false }),
    ).toBe(true);
  });

  it('keeps a member and a publisher out until a cluster is shown', () => {
    expect(
      canEnterFragmentMode({ message: message(), isViewer: false, hasVisibleCluster: false }),
    ).toBe(false);
    expect(
      canEnterFragmentMode({ message: message(), isViewer: false, hasVisibleCluster: true }),
    ).toBe(true);
  });

  it('lets nobody in on a message without text', () => {
    expect(
      canEnterFragmentMode({
        message: message({ kind: 'media', text: null }),
        isViewer: true,
        hasVisibleCluster: true,
      }),
    ).toBe(false);
  });
});

describe('the glow of a bubble', () => {
  it('is there only when the text has a shown cluster', () => {
    expect(hasClusters(message({ clustersCount: 1 }))).toBe(true);
    expect(hasClusters(message({ clustersCount: 0 }))).toBe(false);
    expect(hasClusters(message())).toBe(false);
  });

  it('is not on a message without selectable text', () => {
    expect(hasClusters(message({ clustersCount: 2, kind: 'forward' }))).toBe(false);
  });
});
