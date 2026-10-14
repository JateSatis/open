import { QueryClient } from '@tanstack/react-query';

import { readRoots, rootsInOrder, rootsKey, rootsPageOf } from './commentsCache';
import { loadRoots, syncAuthorPin, syncComments } from './commentSync';

import {
  getPinnedComment,
  listCommentsByIds,
  listThreadRoots,
  type Comment,
} from '@/api/comments';

jest.mock('@/api/comments', () => ({
  getPinnedComment: jest.fn(),
  listCommentsByIds: jest.fn(),
  listThreadRoots: jest.fn(),
  listThreadReplies: jest.fn(),
  listCommentReactions: jest.fn(),
}));

const mockedRoots = jest.mocked(listThreadRoots);
const mockedPinned = jest.mocked(getPinnedComment);
const mockedByIds = jest.mocked(listCommentsByIds);

function comment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    targetId: 'm1',
    chatId: 'chat-1',
    authorId: 'user-2',
    authorName: 'Олег',
    authorAvatarUrl: null,
    audience: 'visitor',
    kind: 'text',
    text: id,
    createdAt: '2026-10-14T10:00:00Z',
    editedAt: null,
    attachments: [],
    reactions: { members: {}, visitors: {}, mine: null },
    replies: [],
    threadRootId: null,
    fragmentId: null,
    repliesCount: 0,
    rank: 0,
    deleted: false,
    ...overrides,
  };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);
const scope = { key: 'm1:4-27', fragmentId: 'f1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockedRoots.mockResolvedValue({ items: [], nextCursor: null });
  mockedPinned.mockResolvedValue(null);
});

describe('the top of a fragment panel', () => {
  it('asks the server only for the fragment’s roots', async () => {
    mockedRoots.mockResolvedValue({ items: [comment('a', { fragmentId: 'f1' })], nextCursor: null });

    const page = await loadRoots('m1', scope);

    expect(mockedRoots).toHaveBeenCalledWith('m1', { fragmentId: 'f1' });
    expect(ids(rootsInOrder(page))).toEqual(['a']);
    expect(page.scope).toEqual(scope);
  });

  it('is empty without a request while my new fragment is not in the base yet', async () => {
    const page = await loadRoots('m1', { key: 'm1:4-27', fragmentId: null });

    expect(mockedRoots).not.toHaveBeenCalled();
    expect(rootsInOrder(page)).toEqual([]);
  });

  it('shows the pin only when the pinned comment is of this fragment', async () => {
    mockedPinned.mockResolvedValue(comment('pinned', { fragmentId: 'f2' }));
    expect((await loadRoots('m1', scope)).authorPin).toBeNull();

    mockedPinned.mockResolvedValue(comment('pinned', { fragmentId: 'f1' }));
    expect((await loadRoots('m1', scope)).authorPin?.id).toBe('pinned');
  });

  it('takes a new comment of its fragment live — someone else’s too — and leaves the rest', async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(rootsKey('m1', scope.key), {
      ...rootsPageOf({ items: [], nextCursor: null }),
      scope,
    });
    queryClient.setQueryData(rootsKey('m1'), rootsPageOf({ items: [], nextCursor: null }));
    mockedByIds.mockResolvedValue([
      comment('mine-fragment', { fragmentId: 'f1' }),
      comment('other-fragment', { fragmentId: 'f2' }),
      comment('plain'),
    ]);

    await syncComments(queryClient, 'm1', 'me', {
      added: ['mine-fragment', 'other-fragment', 'plain'],
      changed: [],
    });

    expect(ids(rootsInOrder(readRoots(queryClient, 'm1', scope.key)!))).toEqual(['mine-fragment']);
    // В общем шите чужой новый, как и раньше, — при следующем открытии.
    expect(rootsInOrder(readRoots(queryClient, 'm1')!)).toEqual([]);
  });

  it('follows a new pin: the panel shows it only for its fragment', async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(rootsKey('m1', scope.key), {
      ...rootsPageOf({ items: [], nextCursor: null }),
      scope,
    });
    queryClient.setQueryData(rootsKey('m1'), rootsPageOf({ items: [], nextCursor: null }));
    mockedPinned.mockResolvedValue(comment('pinned', { fragmentId: 'f2' }));

    await syncAuthorPin(queryClient, 'm1');

    expect(readRoots(queryClient, 'm1')?.authorPin?.id).toBe('pinned');
    expect(readRoots(queryClient, 'm1', scope.key)?.authorPin).toBeNull();
  });
});
