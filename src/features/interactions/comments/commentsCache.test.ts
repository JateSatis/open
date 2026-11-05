import { QueryClient } from '@tanstack/react-query';

import {
  EMPTY_COMMENT_THREAD,
  addToCommentThread,
  appendRoots,
  appendCommentThreadHead,
  focusedCommentThread,
  loadedComments,
  raiseRoot,
  prependCommentThreadHead,
  replaceComments,
  rootsInOrder,
  setAuthorPin,
  rootsKey,
  rootsPageOf,
  commentThreadQueryKey,
  updateAllComments,
  type RootsPage,
  type CommentThreadPage,
} from './commentsCache';
import { asDeletedRoot, toCommentItem } from './commentItem';

import type { Comment } from '@/api/comments';

function comment(id: string, minute: number, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    targetId: 'm1',
    chatId: 'chat-1',
    authorId: 'user-1',
    authorName: 'Марина',
    authorAvatarUrl: null,
    audience: 'visitor',
    kind: 'text',
    text: id,
    createdAt: `2026-09-30T10:${String(minute).padStart(2, '0')}:00Z`,
    editedAt: null,
    attachments: [],
    reactions: { members: {}, visitors: {}, mine: null },
    replies: [],
    commentThreadRootId: null,
    fragmentId: null,
    fragmentQuote: null,
    repliesCount: 0,
    rank: 0,
    deleted: false,
    ...overrides,
  };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe('roots cache', () => {
  it('appends the next page in rank order and drops repeats whose rank grew', () => {
    const page = rootsPageOf({ items: [comment('a', 1), comment('b', 2)], nextCursor: null });
    const next = appendRoots(page, [comment('b', 2), comment('c', 3)], null);

    expect(ids(rootsInOrder(next))).toEqual(['a', 'b', 'c']);
  });

  it('keeps my freshly sent comment at the top, once', () => {
    const page = rootsPageOf({ items: [comment('a', 1), comment('b', 2)], nextCursor: null });
    const raised = raiseRoot(page, toCommentItem(comment('b', 2)));

    expect(ids(rootsInOrder(raised))).toEqual(['b', 'a']);
  });
});

describe('author pin', () => {
  // Ранг убывает: c выше всех, a ниже.
  const ranked = () =>
    rootsPageOf({
      items: [
        comment('c', 3, { rank: 30 }),
        comment('b', 2, { rank: 20 }),
        comment('a', 1, { rank: 10 }),
      ],
      nextCursor: null,
    });

  it('puts the pinned comment first and above the raised ones, without a repeat', () => {
    const page = raiseRoot(ranked(), toCommentItem(comment('c', 3, { rank: 30 })));
    const pinned = setAuthorPin(page, toCommentItem(comment('a', 1, { rank: 10 })));

    expect(ids(rootsInOrder(pinned))).toEqual(['a', 'c', 'b']);
  });

  it('returns the previous pin to its rank place when another is pinned', () => {
    const first = setAuthorPin(ranked(), toCommentItem(comment('b', 2, { rank: 20 })));
    const second = setAuthorPin(first, toCommentItem(comment('a', 1, { rank: 10 })));

    expect(ids(rootsInOrder(second))).toEqual(['a', 'c', 'b']);
  });

  it('restores the rank order after unpin', () => {
    const pinned = setAuthorPin(ranked(), toCommentItem(comment('a', 1, { rank: 10 })));

    expect(ids(rootsInOrder(setAuthorPin(pinned, null)))).toEqual(['c', 'b', 'a']);
  });

  it('leaves an unpinned comment to a later page when its place is past the loaded ones', () => {
    const page = rootsPageOf({
      items: [comment('c', 3, { rank: 30 }), comment('b', 2, { rank: 20 })],
      nextCursor: { rank: 20, id: 'b' },
    });
    const pinned = setAuthorPin(page, toCommentItem(comment('a', 1, { rank: 10 })));

    expect(ids(rootsInOrder(setAuthorPin(pinned, null)))).toEqual(['c', 'b']);
  });

  it('does not raise the pinned comment under itself', () => {
    const pinned = setAuthorPin(ranked(), toCommentItem(comment('b', 2, { rank: 20 })));
    const raised = raiseRoot(pinned, toCommentItem(comment('b', 2, { rank: 20 })));

    expect(ids(rootsInOrder(raised))).toEqual(['b', 'c', 'a']);
  });

  it('takes the pinned comment out of the first page on load', () => {
    const page = rootsPageOf(
      { items: [comment('c', 3, { rank: 30 }), comment('b', 2, { rank: 20 })], nextCursor: null },
      comment('b', 2, { rank: 20 }),
    );

    expect(ids(rootsInOrder(page))).toEqual(['b', 'c']);
  });
});

describe('comment thread cache', () => {
  const reply = (id: string, minute: number) => comment(id, minute, { commentThreadRootId: 'root' });

  it('keeps my reply past the gap until the head reaches it', () => {
    let page: CommentThreadPage = appendCommentThreadHead(EMPTY_COMMENT_THREAD, [reply('r1', 1)], {
      createdAt: reply('r1', 1).createdAt,
      id: 'r1',
    });

    page = addToCommentThread(page, toCommentItem(reply('mine', 9)));
    expect(ids(page.head)).toEqual(['r1']);
    expect(ids(page.tail)).toEqual(['mine']);

    page = appendCommentThreadHead(page, [reply('r2', 2), reply('mine', 9)], null);
    expect(ids(page.head)).toEqual(['r1', 'r2', 'mine']);
    expect(page.tail).toEqual([]);
  });

  it('puts a new reply at the end of a fully loaded comment thread', () => {
    const page = addToCommentThread(appendCommentThreadHead(EMPTY_COMMENT_THREAD, [reply('r1', 1)], null), toCommentItem(reply('r2', 2)));

    expect(ids(page.head)).toEqual(['r1', 'r2']);
  });

  it('keeps the tail when the head has not been read yet', () => {
    const page = addToCommentThread(EMPTY_COMMENT_THREAD, toCommentItem(reply('mine', 9)));

    expect(page.headLoaded).toBe(false);
    expect(ids(page.tail)).toEqual(['mine']);
  });

  it('seeds a chronological window around a distant reply and keeps both cursors', () => {
    const page = focusedCommentThread(
      [reply('r4', 4), reply('r5', 5)],
      reply('target', 6),
      [reply('r7', 7), reply('r8', 8)],
      { createdAt: reply('r4', 4).createdAt, id: 'r4' },
      { createdAt: reply('r8', 8).createdAt, id: 'r8' },
    );

    expect(ids(page.head)).toEqual(['r4', 'r5', 'target']);
    expect(ids(page.tail)).toEqual(['r7', 'r8']);
    expect(page.beforeCursor?.id).toBe('r4');
    expect(page.nextCursor).toEqual({ createdAt: reply('r8', 8).createdAt, id: 'r8' });
  });

  it('replaces a distant partial prefix with the focus window and prepends earlier pages once', () => {
    const prior = appendCommentThreadHead(EMPTY_COMMENT_THREAD, [reply('r1', 1), reply('r2', 2)], {
      createdAt: reply('r2', 2).createdAt,
      id: 'r2',
    });
    const focused = focusedCommentThread(
      [reply('r4', 4), reply('r5', 5)],
      reply('target', 6),
      [reply('r7', 7)],
      { createdAt: reply('r4', 4).createdAt, id: 'r4' },
      null,
      prior,
    );
    const earlier = prependCommentThreadHead(
      focused,
      [reply('r3', 3), reply('r4', 4)],
      { createdAt: reply('r3', 3).createdAt, id: 'r3' },
    );

    expect(ids(earlier.head)).toEqual(['r3', 'r4', 'r5', 'target']);
    expect(ids(earlier.tail)).toEqual(['r7']);
    expect(earlier.beforeCursor?.id).toBe('r3');
    expect(new Set([...ids(earlier.head), ...ids(earlier.tail)]).size).toBe(5);
  });

  it('keeps a deleted root as a content-free thread placeholder', () => {
    const root = asDeletedRoot(toCommentItem(comment('root', 1, { deleted: true, repliesCount: 1 })));
    const page = focusedCommentThread([], reply('target', 2), [], null, null);

    expect(root).toMatchObject({ id: 'root', deleted: true, text: null, authorId: null });
    expect(page.head[0].id).toBe('target');
  });

  it('has no lower gap when every reply after the focus is already in the window', () => {
    const page = focusedCommentThread(
      [reply('r4', 4)],
      reply('target', 5),
      [reply('r6', 6), reply('r7', 7)],
      { createdAt: reply('r4', 4).createdAt, id: 'r4' },
      null,
    );

    expect(ids(page.head)).toEqual(['r4', 'target']);
    expect(ids(page.tail)).toEqual(['r6', 'r7']);
    expect(page.nextCursor).toBeNull();
  });
});

describe('every loaded comment', () => {
  function seeded() {
    const queryClient = new QueryClient();

    queryClient.setQueryData<RootsPage>(
      rootsKey('m1'),
      rootsPageOf({ items: [comment('root', 1, { repliesCount: 1 })], nextCursor: null }),
    );
    queryClient.setQueryData<CommentThreadPage>(
      commentThreadQueryKey('m1', 'root'),
      appendCommentThreadHead(EMPTY_COMMENT_THREAD, [comment('r1', 2, { commentThreadRootId: 'root' })], null),
    );

    return queryClient;
  }

  it('finds comments both in the top and in comment threads', () => {
    expect([...loadedComments(seeded(), 'm1').keys()].sort()).toEqual(['r1', 'root']);
  });

  it('replaces an edited comment wherever it lies, keeping previews only while files stay', () => {
    const queryClient = seeded();

    updateAllComments(queryClient, 'm1', (item) =>
      item.id === 'r1' ? { ...item, localPreviews: ['file://x'] } : item,
    );
    replaceComments(queryClient, 'm1', [
      comment('r1', 2, { commentThreadRootId: 'root', text: 'правка', editedAt: '2026-09-30T11:00:00Z' }),
    ]);

    const edited = loadedComments(queryClient, 'm1').get('r1');

    expect(edited?.text).toBe('правка');
    expect(edited?.localPreviews).toBeUndefined();
  });

  it('removes a comment and leaves the rest untouched', () => {
    const queryClient = seeded();

    updateAllComments(queryClient, 'm1', (item) => (item.id === 'r1' ? null : item));

    expect([...loadedComments(queryClient, 'm1').keys()]).toEqual(['root']);
  });
});
