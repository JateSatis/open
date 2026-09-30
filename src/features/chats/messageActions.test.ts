import {
  canCommentOn,
  canReactTo,
  deletedOriginalActions,
  islandActions,
  SELECTION_ACTIONS,
  visibleMessageActions,
  type MessageActionContext,
  type SelectionActionId,
} from './messageActions';

import type { BubbleRow } from '@/features/chats/islands/rows';
import type { ChatMessage } from '@/features/chats/messages/types';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    chatId: 'chat-1',
    authorId: 'user-2',
    kind: 'text',
    text: 'привет',
    createdAt: '2026-09-27T10:00:00Z',
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
    status: 'sent',
    ...overrides,
  };
}

function labels(context: MessageActionContext): string[] {
  return visibleMessageActions(context).map((action) => action.label);
}

describe('«Изменить»', () => {
  const own = { isOwn: true, isMember: true, isPinned: false };

  function offersEdit(context: MessageActionContext): boolean {
    return labels(context).includes('Изменить');
  }

  it('is there for my own sent text, album and voice message', () => {
    expect(offersEdit({ ...own, message: message({ authorId: 'user-1' }) })).toBe(true);
    expect(offersEdit({ ...own, message: message({ kind: 'media' }) })).toBe(true);
    expect(offersEdit({ ...own, message: message({ kind: 'voice', text: null }) })).toBe(true);
  });

  it('is never there for somebody else’s message or for a visitor', () => {
    expect(offersEdit({ ...own, isOwn: false, message: message() })).toBe(false);
    expect(offersEdit({ ...own, isMember: false, message: message() })).toBe(false);
  });

  it('is not there while sending, after a failed send or while another edit saves', () => {
    expect(offersEdit({ ...own, message: message({ status: 'sending', localId: 'l1' }) })).toBe(
      false,
    );
    expect(offersEdit({ ...own, message: message({ status: 'failed', localId: 'l1' }) })).toBe(
      false,
    );
    expect(offersEdit({ ...own, message: message({ editStatus: 'saving' }) })).toBe(false);
  });

  it('is not there for a forward island, an original shown in one, or a system message', () => {
    expect(offersEdit({ ...own, message: message({ kind: 'forward' }) })).toBe(false);
    // Своё сообщение в островке правят там, где оно живёт.
    expect(offersEdit({ ...own, message: message(), island: { isMine: false } })).toBe(false);
    expect(offersEdit({ ...own, message: message({ kind: 'system' }) })).toBe(false);
  });
});

describe('message menu', () => {
  it('shows a member everything for their own message', () => {
    expect(
      labels({ message: message({ authorId: 'user-1' }), isOwn: true, isMember: true, isPinned: false }),
    ).toEqual([
      'Ответить',
      'Копировать',
      'Изменить',
      'Закрепить',
      'Переслать',
      'Выбрать',
      'Удалить',
    ]);
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

describe('message menu of a bubble in a forward island', () => {
  const inIsland = (isMine: boolean, isOwn = false) =>
    labels({ message: message(), isOwn, isMember: true, isPinned: false, island: { isMine } });

  it('acts on the original: reply, copy, pin, forward, go to it — never edit or delete it', () => {
    expect(inIsland(false, true)).toEqual([
      'Ответить',
      'Копировать',
      'Закрепить',
      'Переслать',
      'Перейти к оригиналу',
      'Выбрать',
    ]);
  });

  it('lets only the forwarder take a bubble out of the island', () => {
    expect(inIsland(true)).toContain('Убрать из пересылки');
    expect(inIsland(false)).not.toContain('Убрать из пересылки');
  });

  it('offers only removal on a deleted original, and only to the forwarder', () => {
    expect(deletedOriginalActions(true).map((action) => action.label)).toEqual([
      'Выбрать',
      'Убрать из пересылки',
    ]);
    expect(deletedOriginalActions(false)).toEqual([]);
  });

  it('gives the island itself no reactions or comments — only select, retry and delete', () => {
    const sent = message({ kind: 'forward', authorId: 'user-1' });

    expect(islandActions(sent, true).map((action) => action.id)).toEqual([
      'select_all',
      'delete_island',
    ]);
    expect(islandActions(sent, false).map((action) => action.id)).toEqual(['select_all']);
    expect(
      islandActions(message({ kind: 'forward', status: 'failed', localId: 'l1' }), true).map(
        (action) => action.id,
      ),
    ).toEqual(['retry', 'delete_island']);
  });
});

describe('selection panel', () => {
  const asRow = (item: ChatMessage): BubbleRow => ({ type: 'message', key: item.id, message: item });

  function islandRow(authorId: string, withOriginal = true): BubbleRow {
    const forward = message({ id: 'isl', kind: 'forward', authorId });

    return {
      type: 'island-item',
      key: 'isl/o1',
      island: forward,
      item: {
        id: 'i1',
        position: 0,
        messageId: 'o1',
        original: withOriginal
          ? { ...message({ id: 'o1', authorId: 'user-9' }), authorName: 'Джиган', authorAvatarUrl: null, chat: null }
          : null,
      },
      isLast: true,
    };
  }

  function enabled(selected: (ChatMessage | BubbleRow)[], isMember = true): SelectionActionId[] {
    const rows = selected.map((item) => ('type' in item && 'key' in item ? item : asRow(item as ChatMessage)));

    return SELECTION_ACTIONS.filter((action) =>
      action.isEnabled({ selected: rows as BubbleRow[], currentUserId: 'user-1', isMember }),
    ).map((action) => action.id);
  }

  it('deletes a bubble of my own island with my messages, but not of somebody else\'s', () => {
    const mine = message({ id: 'a', authorId: 'user-1' });

    expect(enabled([mine, islandRow('user-1')])).toContain('delete');
    expect(enabled([mine, islandRow('user-2')])).not.toContain('delete');
  });

  it('neither quotes nor forwards a deleted original', () => {
    expect(enabled([islandRow('user-1')])).toEqual(expect.arrayContaining(['reply', 'forward']));
    expect(enabled([islandRow('user-1', false)])).not.toContain('forward');
    expect(enabled([islandRow('user-1', false)])).not.toContain('reply');
  });

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

describe('reactions', () => {
  it('can be put on a sent message, own or not, by anyone', () => {
    expect(canReactTo(message())).toBe(true);
    expect(canReactTo(message({ authorId: 'user-1' }))).toBe(true);
  });

  it('are not offered on an unsent, failed or system message, or on a forward island', () => {
    expect(canReactTo(message({ status: 'sending' }))).toBe(false);
    expect(canReactTo(message({ status: 'failed' }))).toBe(false);
    expect(canReactTo(message({ kind: 'system' }))).toBe(false);
    expect(canReactTo(message({ kind: 'forward' }))).toBe(false);
  });
});

describe('comments', () => {
  it('are there on every sent message of a person — but not on a forward island itself', () => {
    expect(canCommentOn(message())).toBe(true);
    expect(canCommentOn(message({ kind: 'voice', text: null }))).toBe(true);
    expect(canCommentOn(message({ kind: 'forward' }))).toBe(false);
  });

  it('are not there on a message the server has not confirmed or that failed', () => {
    expect(canCommentOn(message({ status: 'sending', localId: 'l1' }))).toBe(false);
    expect(canCommentOn(message({ status: 'failed', localId: 'l1' }))).toBe(false);
  });

  it('are not there on a system message', () => {
    expect(canCommentOn(message({ kind: 'system' }))).toBe(false);
  });
});
