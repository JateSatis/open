import { visibleCommentActions } from './commentActions';
import type { CommentItem } from './commentItem';

import { NO_REACTIONS } from '@/api/reactionCounts';

function comment(overrides: Partial<CommentItem> = {}): CommentItem {
  return {
    id: 'c1',
    chatId: 'chat-1',
    targetId: 'm1',
    authorId: 'user-1',
    authorName: 'Я',
    authorAvatarUrl: null,
    audience: 'visitor',
    kind: 'text',
    text: 'комментарий',
    seq: Date.parse('2026-09-30T10:00:00Z'),
    createdAt: '2026-09-30T10:00:00Z',
    editedAt: null,
    edited: false,
    editMark: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    status: 'sent',
    commentThreadRootId: null,
    repliesCount: 0,
    deleted: false,
    ...overrides,
  };
}

function ids(context: Parameters<typeof visibleCommentActions>[0]) {
  return visibleCommentActions(context).map((action) => action.id);
}

describe('comment menu', () => {
  // Пересылка комментариев включена (треды и пересылка, 04.10.2026). Закреп
  // — только автору контента (этап 3в), здесь его нет.
  it('offers everything a message has except pin on my own sent comment', () => {
    expect(ids({ comment: comment(), isOwn: true, targetLive: true })).toEqual([
      'reply',
      'copy',
      'edit',
      'forward',
      'select',
      'delete',
    ]);
  });

  it('lets anyone reply to, forward and select somebody else’s comment, but not edit or delete it', () => {
    expect(ids({ comment: comment(), isOwn: false, targetLive: true })).toEqual([
      'reply',
      'copy',
      'forward',
      'select',
    ]);
  });

  it('takes no replies or edits once the message itself is deleted, but still forwards', () => {
    expect(ids({ comment: comment(), isOwn: true, targetLive: false })).toEqual([
      'copy',
      'forward',
      'select',
      'delete',
    ]);
  });

  it('offers retry and delete on a failed comment of mine', () => {
    expect(
      ids({ comment: comment({ status: 'failed', localId: 'l1' }), isOwn: true, targetLive: true }),
    ).toEqual(['retry', 'delete']);
  });

  it('has nothing to copy on a voice comment', () => {
    expect(
      ids({ comment: comment({ kind: 'voice', text: null }), isOwn: false, targetLive: true }),
    ).toEqual(['reply', 'forward', 'select']);
  });

  describe('pin', () => {
    it('offers pin to the author of the content on any top-level comment', () => {
      expect(ids({ comment: comment(), isOwn: false, targetLive: true, canPin: true })).toEqual([
        'reply',
        'copy',
        'pin',
        'forward',
        'select',
      ]);
    });

    it('offers unpin instead on the pinned one', () => {
      const actions = ids({
        comment: comment(),
        isOwn: false,
        targetLive: true,
        canPin: true,
        isPinned: true,
      });

      expect(actions).toContain('unpin');
      expect(actions).not.toContain('pin');
    });

    it('has no pin on a reply in a comment thread', () => {
      const actions = ids({
        comment: comment({ commentThreadRootId: 'root' }),
        isOwn: false,
        targetLive: true,
        canPin: true,
      });

      expect(actions).not.toContain('pin');
      expect(actions).not.toContain('unpin');
    });

    it('has no pin for anyone else, for an unsent comment or once the target is gone', () => {
      expect(ids({ comment: comment(), isOwn: true, targetLive: true })).not.toContain('pin');
      expect(
        ids({
          comment: comment({ status: 'sending', localId: 'l1' }),
          isOwn: true,
          targetLive: true,
          canPin: true,
        }),
      ).not.toContain('pin');
      expect(ids({ comment: comment(), isOwn: false, targetLive: false, canPin: true })).not.toContain(
        'pin',
      );
    });
  });
});
