import {
  SELECTION_ACTIONS,
  visibleMessageActions,
  type MessageActionContext,
  type SelectionActionId,
} from './messageActions';

import type { ChatMessage } from '@/features/chats/messages/types';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    chatId: 'chat-1',
    authorId: 'user-2',
    kind: 'text',
    text: 'привет',
    createdAt: '2026-09-27T10:00:00Z',
    attachments: [],
    replies: [],
    forward: null,
    status: 'sent',
    ...overrides,
  };
}

function labels(context: MessageActionContext): string[] {
  return visibleMessageActions(context).map((action) => action.label);
}

describe('message menu', () => {
  it('shows a member everything for their own message', () => {
    expect(
      labels({ message: message({ authorId: 'user-1' }), isOwn: true, isMember: true, isPinned: false }),
    ).toEqual(['Ответить', 'Копировать', 'Закрепить', 'Переслать', 'Выбрать', 'Удалить']);
  });

  it('never offers a member to delete somebody else’s message', () => {
    expect(labels({ message: message(), isOwn: false, isMember: true, isPinned: false })).toEqual([
      'Ответить',
      'Копировать',
      'Закрепить',
      'Переслать',
      'Выбрать',
    ]);
  });

  it('lets a visitor copy, forward and select — no replying, pinning or deleting', () => {
    expect(labels({ message: message(), isOwn: false, isMember: false, isPinned: false })).toEqual([
      'Копировать',
      'Переслать',
      'Выбрать',
    ]);
    expect(labels({ message: message(), isOwn: false, isMember: false, isPinned: true })).toEqual([
      'Копировать',
      'Переслать',
      'Выбрать',
    ]);
  });

  it('offers to unpin instead of pin once the message is pinned', () => {
    expect(labels({ message: message(), isOwn: false, isMember: true, isPinned: true })).toEqual([
      'Ответить',
      'Копировать',
      'Открепить',
      'Переслать',
      'Выбрать',
    ]);
  });

  it('has no copy for a message without text, but still reply and forward', () => {
    const voice = message({ kind: 'voice', text: null });
    const shown = labels({ message: voice, isOwn: false, isMember: true, isPinned: false });

    expect(shown).not.toContain('Копировать');
    expect(shown).toEqual(expect.arrayContaining(['Ответить', 'Переслать']));
  });

  it('gives an own failed message only retry and delete — no reply, no forward', () => {
    const failed = message({ authorId: 'user-1', status: 'failed', localId: 'local-1' });

    expect(labels({ message: failed, isOwn: true, isMember: true, isPinned: false })).toEqual([
      'Повторить',
      'Удалить',
    ]);
  });

  it('gives an own message still sending only delete', () => {
    const sending = message({ authorId: 'user-1', status: 'sending', localId: 'local-1' });

    expect(labels({ message: sending, isOwn: true, isMember: true, isPinned: false })).toEqual([
      'Удалить',
    ]);
  });
});

describe('selection panel', () => {
  function enabled(selected: ChatMessage[], isMember = true): SelectionActionId[] {
    return SELECTION_ACTIONS.filter((action) =>
      action.isEnabled({ selected, currentUserId: 'user-1', isMember }),
    ).map((action) => action.id);
  }

  it('puts reply and forward next to copy and delete', () => {
    expect(SELECTION_ACTIONS.map((action) => action.label)).toEqual([
      'Ответить',
      'Переслать',
      'Копировать',
      'Удалить',
    ]);
  });

  it('allows deleting only when every selected message is mine', () => {
    const mine = message({ id: 'a', authorId: 'user-1' });
    const theirs = message({ id: 'b', authorId: 'user-2' });

    expect(enabled([mine])).toContain('delete');
    expect(enabled([mine, theirs])).not.toContain('delete');
  });

  it('disables copying when none of the selected messages has text', () => {
    const voice = message({ kind: 'voice', text: null, authorId: 'user-1' });

    expect(enabled([voice])).not.toContain('copy');
    expect(enabled([voice, message()])).toContain('copy');
  });

  it('lets a member reply to and forward several messages at once', () => {
    const picked = [message({ id: 'a' }), message({ id: 'b', authorId: 'user-1' })];

    expect(enabled(picked)).toEqual(expect.arrayContaining(['reply', 'forward']));
  });

  it('keeps reply disabled — not hidden — for a visitor, who may still forward', () => {
    const shown = enabled([message()], false);

    expect(SELECTION_ACTIONS.some((action) => action.id === 'reply')).toBe(true);
    expect(shown).not.toContain('reply');
    expect(shown).toContain('forward');
  });
});
