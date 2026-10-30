import { buildCommentRows, buildCommentThreadRows, type OpenCommentThread } from './rows';

import { NO_REACTIONS } from '@/api/reactionCounts';
import type { CommentItem } from '@/features/interactions/comments/commentItem';

function comment(id: string, extra: Partial<CommentItem> = {}): CommentItem {
  return {
    id,
    chatId: 'chat',
    targetId: 'm',
    authorId: 'u',
    authorName: 'U',
    authorAvatarUrl: null,
    audience: 'visitor',
    kind: 'text',
    text: id,
    seq: Date.parse('2026-10-04T10:00:00Z'),
    createdAt: '2026-10-04T10:00:00Z',
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
    ...extra,
  };
}

const root = comment('a', { repliesCount: 5 });

const open = (extra: Partial<OpenCommentThread>): OpenCommentThread => ({
  root,
  rootId: 'a',
  head: [],
  tail: [],
  pending: [],
  hasGap: false,
  isLoading: false,
  ...extra,
});

describe('buildCommentRows', () => {
  const roots = [root, comment('b'), comment('c', { repliesCount: 1 })];

  it('shows only roots, with the reply count on the button', () => {
    const rows = buildCommentRows(roots);

    expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c']);
    expect(rows.map((row) => (row.type === 'comment' ? row.replies : -1))).toEqual([5, 0, 1]);
  });

  it('counts own unsent replies on the button', () => {
    const rows = buildCommentRows(roots, (rootId) => (rootId === 'b' ? 2 : 0));

    expect(rows[1]).toMatchObject({ key: 'b', replies: 2 });
  });

  it('keeps a deleted root while it has replies and hides it without them', () => {
    const rows = buildCommentRows([
      comment('gone', { deleted: true, repliesCount: 2 }),
      comment('empty', { deleted: true }),
    ]);

    expect(rows.map((row) => row.key)).toEqual(['gone']);
  });
});

describe('buildCommentThreadRows', () => {
  it('puts the root first, then the head, a gap with the rest, then the tail', () => {
    const rows = buildCommentThreadRows(
      open({
        head: [comment('r1', { commentThreadRootId: 'a' }), comment('r2', { commentThreadRootId: 'a' })],
        tail: [comment('mine', { commentThreadRootId: 'a' })],
        hasGap: true,
      }),
    );

    expect(rows.map((row) => row.key)).toEqual(['a', 'r1', 'r2', 'a/gap', 'mine']);
    expect(rows.find((row) => row.type === 'comment-thread-gap')).toMatchObject({ hidden: 2 });
  });

  it('marks only the root as the comment thread root and puts no reply button anywhere', () => {
    const rows = buildCommentThreadRows(open({ head: [comment('r1', { commentThreadRootId: 'a' })] }));

    expect(rows.map((row) => (row.type === 'comment' ? [row.commentThreadRoot, row.replies] : null))).toEqual([
      [true, 0],
      [false, 0],
    ]);
  });

  it('shows own unsent replies at the very end', () => {
    const rows = buildCommentThreadRows(
      open({
        head: [comment('r1', { commentThreadRootId: 'a' })],
        pending: [comment('local-1', { commentThreadRootId: 'a', status: 'sending' })],
      }),
    );

    expect(rows.map((row) => row.key)).toEqual(['a', 'r1', 'local-1']);
  });

  it('shows a loading row under the root until the head arrives', () => {
    const rows = buildCommentThreadRows(open({ isLoading: true }));

    expect(rows.map((row) => row.type)).toEqual(['comment', 'comment-thread-loading']);
  });

  it('keeps a deleted root on top as a stub', () => {
    const gone = comment('a', { deleted: true, repliesCount: 1 });
    const rows = buildCommentThreadRows(open({ root: gone, head: [comment('r1', { commentThreadRootId: 'a' })] }));

    expect(rows[0]).toMatchObject({ key: 'a', commentThreadRoot: true, comment: { deleted: true } });
  });
});
