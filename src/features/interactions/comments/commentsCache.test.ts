import { QueryClient } from '@tanstack/react-query';

import {
  EMPTY_THREAD,
  addToThread,
  appendRoots,
  appendThreadHead,
  loadedComments,
  pinRoot,
  replaceComments,
  rootsInOrder,
  rootsKey,
  rootsPageOf,
  threadKey,
  updateAllComments,
  type RootsPage,
  type ThreadPage,
} from './commentsCache';
import { toCommentItem } from './commentItem';

import type { Comment } from '@/api/comments';

function comment(id: string, minute: number, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    messageId: 'm1',
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
    threadRootId: null,
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
    const pinned = pinRoot(page, toCommentItem(comment('b', 2)));

    expect(ids(rootsInOrder(pinned))).toEqual(['b', 'a']);
  });
});

describe('thread cache', () => {
  const reply = (id: string, minute: number) => comment(id, minute, { threadRootId: 'root' });

  it('keeps my reply past the gap until the head reaches it', () => {
    let page: ThreadPage = appendThreadHead(EMPTY_THREAD, [reply('r1', 1)], 'cursor');

    page = addToThread(page, toCommentItem(reply('mine', 9)));
    expect(ids(page.head)).toEqual(['r1']);
    expect(ids(page.tail)).toEqual(['mine']);

    page = appendThreadHead(page, [reply('r2', 2), reply('mine', 9)], null);
    expect(ids(page.head)).toEqual(['r1', 'r2', 'mine']);
    expect(page.tail).toEqual([]);
  });

  it('puts a new reply at the end of a fully loaded thread', () => {
    const page = addToThread(appendThreadHead(EMPTY_THREAD, [reply('r1', 1)], null), toCommentItem(reply('r2', 2)));

    expect(ids(page.head)).toEqual(['r1', 'r2']);
  });

  it('keeps the tail when the head has not been read yet', () => {
    const page = addToThread(EMPTY_THREAD, toCommentItem(reply('mine', 9)));

    expect(page.headLoaded).toBe(false);
    expect(ids(page.tail)).toEqual(['mine']);
  });
});

describe('every loaded comment', () => {
  function seeded() {
    const queryClient = new QueryClient();

    queryClient.setQueryData<RootsPage>(
      rootsKey('m1'),
      rootsPageOf({ items: [comment('root', 1, { repliesCount: 1 })], nextCursor: null }),
    );
    queryClient.setQueryData<ThreadPage>(
      threadKey('m1', 'root'),
      appendThreadHead(EMPTY_THREAD, [comment('r1', 2, { threadRootId: 'root' })], null),
    );

    return queryClient;
  }

  it('finds comments both in the top and in threads', () => {
    expect([...loadedComments(seeded(), 'm1').keys()].sort()).toEqual(['r1', 'root']);
  });

  it('replaces an edited comment wherever it lies, keeping previews only while files stay', () => {
    const queryClient = seeded();

    updateAllComments(queryClient, 'm1', (item) =>
      item.id === 'r1' ? { ...item, localPreviews: ['file://x'] } : item,
    );
    replaceComments(queryClient, 'm1', [
      comment('r1', 2, { threadRootId: 'root', text: 'правка', editedAt: '2026-09-30T11:00:00Z' }),
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
