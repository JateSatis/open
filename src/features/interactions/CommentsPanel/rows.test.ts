import { buildCommentRows, buildThreadRows, type OpenThread } from './rows';

import { NO_REACTIONS } from '@/api/reactionCounts';
import type { CommentItem } from '@/features/interactions/comments/commentItem';

function comment(id: string, extra: Partial<CommentItem> = {}): CommentItem {
  return {
    id,
    chatId: 'chat',
    messageId: 'm',
    authorId: 'u',
    authorName: 'U',
    authorAvatarUrl: null,
    audience: 'visitor',
    kind: 'text',
    text: id,
    createdAt: '2026-10-04T10:00:00Z',
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    status: 'sent',
    threadRootId: null,
    repliesCount: 0,
    deleted: false,
    ...extra,
  };
}

const root = comment('a', { repliesCount: 5 });

const open = (extra: Partial<OpenThread>): OpenThread => ({
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

describe('buildThreadRows', () => {
  it('puts the root first, then the head, a gap with the rest, then the tail', () => {
    const rows = buildThreadRows(
      open({
        head: [comment('r1', { threadRootId: 'a' }), comment('r2', { threadRootId: 'a' })],
        tail: [comment('mine', { threadRootId: 'a' })],
        hasGap: true,
      }),
    );

    expect(rows.map((row) => row.key)).toEqual(['a', 'r1', 'r2', 'a/gap', 'mine']);
    expect(rows.find((row) => row.type === 'thread-gap')).toMatchObject({ hidden: 2 });
  });

  it('marks only the root as the thread root and puts no reply button anywhere', () => {
    const rows = buildThreadRows(open({ head: [comment('r1', { threadRootId: 'a' })] }));

    expect(rows.map((row) => (row.type === 'comment' ? [row.threadRoot, row.replies] : null))).toEqual([
      [true, 0],
      [false, 0],
    ]);
  });

  it('shows own unsent replies at the very end', () => {
    const rows = buildThreadRows(
      open({
        head: [comment('r1', { threadRootId: 'a' })],
        pending: [comment('local-1', { threadRootId: 'a', status: 'sending' })],
      }),
    );

    expect(rows.map((row) => row.key)).toEqual(['a', 'r1', 'local-1']);
  });

  it('shows a loading row under the root until the head arrives', () => {
    const rows = buildThreadRows(open({ isLoading: true }));

    expect(rows.map((row) => row.type)).toEqual(['comment', 'thread-loading']);
  });

  it('keeps a deleted root on top as a stub', () => {
    const gone = comment('a', { deleted: true, repliesCount: 1 });
    const rows = buildThreadRows(open({ root: gone, head: [comment('r1', { threadRootId: 'a' })] }));

    expect(rows[0]).toMatchObject({ key: 'a', threadRoot: true, comment: { deleted: true } });
  });
});
