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
    threadRootId: null,
    repliesCount: 0,
    deleted: false,
    ...overrides,
  };
}

function ids(context: Parameters<typeof visibleCommentActions>[0]) {
  return visibleCommentActions(context).map((action) => action.id);
}

describe('comment menu', () => {
  // Пересылка комментариев включена (треды и пересылка, 04.10.2026): кроме
  // закрепа, у комментария всё, что у сообщения.
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
});
