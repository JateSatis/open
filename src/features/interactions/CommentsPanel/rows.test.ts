import { buildCommentRows, threadBounds, type OpenThread } from './rows';
import { scrollAfterCollapse, isRootStuck, stickyRootTop, headerBottom } from './stickyRoot';

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
    status: 'sent',
    threadRootId: null,
    repliesCount: 0,
    deleted: false,
    ...extra,
  };
}

const open = (extra: Partial<OpenThread>): OpenThread => ({
  rootId: 'a',
  head: [],
  tail: [],
  pending: [],
  hasGap: false,
  isLoading: false,
  ...extra,
});

describe('buildCommentRows', () => {
  const roots = [comment('a', { repliesCount: 5 }), comment('b'), comment('c', { repliesCount: 1 })];

  it('shows only roots while every thread is closed, with the reply count on the button', () => {
    const rows = buildCommentRows(roots, null);

    expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c']);
    expect(rows.map((row) => (row.type === 'comment' ? row.replies : -1))).toEqual([5, 0, 1]);
    expect(rows.every((row) => row.type === 'comment' && row.thread === null)).toBe(true);
  });

  it('puts the open thread under its root: head, a gap with the rest, then the tail', () => {
    const rows = buildCommentRows(
      roots,
      open({
        head: [comment('r1', { threadRootId: 'a' }), comment('r2', { threadRootId: 'a' })],
        tail: [comment('mine', { threadRootId: 'a' })],
        hasGap: true,
      }),
    );

    expect(rows.map((row) => row.key)).toEqual(['a', 'r1', 'r2', 'a/gap', 'mine', 'b', 'c']);
    expect(rows.find((row) => row.type === 'thread-gap')).toMatchObject({ hidden: 2 });
  });

  it('rounds the thread background at the root and at the last row', () => {
    const rows = buildCommentRows(
      roots,
      open({ head: [comment('r1', { threadRootId: 'a' }), comment('r2', { threadRootId: 'a' })] }),
    );
    const ends = rows.slice(0, 3).map((row) => [row.thread?.first, row.thread?.last]);

    expect(ends).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
  });

  it('shows own unsent replies at the very end of the thread', () => {
    const rows = buildCommentRows(
      roots,
      open({
        head: [comment('r1', { threadRootId: 'a' })],
        pending: [comment('local-1', { threadRootId: 'a', status: 'sending' })],
      }),
      (rootId) => (rootId === 'a' ? 1 : 0),
    );

    expect(rows.map((row) => row.key).slice(0, 3)).toEqual(['a', 'r1', 'local-1']);
    expect(rows[0]).toMatchObject({ replies: 6 });
  });

  it('shows a loading row until the thread head arrives', () => {
    const rows = buildCommentRows(roots, open({ isLoading: true }));

    expect(rows.map((row) => row.type).slice(0, 2)).toEqual(['comment', 'thread-loading']);
  });

  it('keeps a deleted root while it has replies and hides it without them', () => {
    const rows = buildCommentRows(
      [comment('gone', { deleted: true, repliesCount: 2 }), comment('empty', { deleted: true })],
      null,
    );

    expect(rows.map((row) => row.key)).toEqual(['gone']);
  });

  it('finds the bounds of the open thread', () => {
    const rows = buildCommentRows(
      roots,
      open({ head: [comment('r1', { threadRootId: 'a' })], hasGap: true }),
    );

    expect(threadBounds(rows, 'a')).toEqual({ first: 0, last: 2 });
    expect(threadBounds(rows, null)).toBeNull();
  });
});

describe('sticky thread root', () => {
  // Корень на 500, высотой 80; тред кончается на 1500. Шапка 200, ход шита 300.
  const layout = { rootTop: 500, rootHeight: 80, threadBottom: 1500 };

  it('stands on the real root while the root is below the header', () => {
    const below = headerBottom(100, 300, 200);

    expect(below).toBe(500);
    expect(stickyRootTop(layout, below)).toBe(500);
    expect(isRootStuck(layout, below)).toBe(false);
  });

  it('sticks under the header while the thread scrolls', () => {
    const below = headerBottom(700, 300, 200);

    expect(stickyRootTop(layout, below)).toBe(900);
    expect(isRootStuck(layout, below)).toBe(true);
  });

  it('leaves with the bottom of the thread', () => {
    const below = headerBottom(1400, 300, 200);

    expect(stickyRootTop(layout, below)).toBe(1420);
  });

  it('after hiding the thread puts the real root where the sticky copy was', () => {
    const scroll = 700;
    const below = headerBottom(scroll, 300, 200);
    const next = scrollAfterCollapse(layout, scroll, below);

    // Копия стояла на 900 − 700 = 200 от верха окна; корень встаёт туда же.
    expect(layout.rootTop - next).toBe(stickyRootTop(layout, below) - scroll);
    expect(next).toBe(300);
  });

  it('does not move the scroll when the root was not stuck', () => {
    expect(scrollAfterCollapse(layout, 100, headerBottom(100, 300, 200))).toBe(100);
  });
});
