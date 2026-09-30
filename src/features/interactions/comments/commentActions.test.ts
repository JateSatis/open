import { visibleCommentActions } from './commentActions';
import type { CommentItem } from './commentItem';

import { NO_REACTIONS } from '@/api/reactionCounts';

function comment(overrides: Partial<CommentItem> = {}): CommentItem {
  return {
    id: 'c1',
    chatId: 'chat-1',
    messageId: 'm1',
    authorId: 'user-1',
    authorName: 'Я',
    authorAvatarUrl: null,
    audience: 'visitor',
    kind: 'text',
    text: 'комментарий',
    createdAt: '2026-09-30T10:00:00Z',
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    status: 'sent',
    ...overrides,
  };
}

function ids(context: Parameters<typeof visibleCommentActions>[0]) {
  return visibleCommentActions(context).map((action) => action.id);
}

describe('comment menu', () => {
  it('offers copy, edit and delete on my own sent comment', () => {
    expect(ids({ comment: comment(), isOwn: true, targetLive: true })).toEqual([
      'copy',
      'edit',
      'delete',
    ]);
  });

  it('offers only copy on somebody else’s comment — no reactions, no delete', () => {
    expect(ids({ comment: comment(), isOwn: false, targetLive: true })).toEqual(['copy']);
  });

  it('does not offer editing once the message itself is deleted', () => {
    expect(ids({ comment: comment(), isOwn: true, targetLive: false })).toEqual(['copy', 'delete']);
  });

  it('offers retry and delete on a failed comment of mine', () => {
    expect(
      ids({ comment: comment({ status: 'failed', localId: 'l1' }), isOwn: true, targetLive: true }),
    ).toEqual(['retry', 'delete']);
  });

  it('has nothing to copy on a voice comment', () => {
    expect(
      ids({ comment: comment({ kind: 'voice', text: null }), isOwn: false, targetLive: true }),
    ).toEqual([]);
  });
});
