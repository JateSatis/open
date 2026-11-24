import { requestClient } from '@/api/requestClient';
import { QueryClient } from '@tanstack/react-query';

import { readRoots, rootsInOrder, rootsKey, rootsPageOf, type RootsScope } from './commentsCache';
import { loadRoots, syncAuthorPin, syncComments } from './commentSync';

import {
  getPinnedComment,
  listCommentsByIds,
  listCommentThreadRoots,
  type Comment,
} from '@/api/comments';
import { listMessageFragments, type Fragment } from '@/api/fragments';
import { fragmentsKey } from '@/features/chats/fragments/useMessageFragments';

jest.mock('@/api/comments', () => ({
  getPinnedComment: jest.fn(),
  listCommentsByIds: jest.fn(),
  listCommentThreadRoots: jest.fn(),
  listCommentThreadReplies: jest.fn(),
  listCommentReactions: jest.fn(),
}));

jest.mock('@/api/fragments', () => ({
  listMessageFragments: jest.fn(),
}));

const mockedRoots = jest.mocked(listCommentThreadRoots);
const mockedPinned = jest.mocked(getPinnedComment);
const mockedByIds = jest.mocked(listCommentsByIds);
const mockedFragments = jest.mocked(listMessageFragments);

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
    commentThreadRootId: null,
    fragmentId: null,
    fragmentQuote: null,
    repliesCount: 0,
    rank: 0,
    deleted: false,
    ...overrides,
  };
}

function fragment(id: string, start: number, end: number, clusterId: string | null): Fragment {
  return {
    id,
    messageId: 'm1',
    authorId: 'user-2',
    start,
    end,
    exactText: 'x'.repeat(end - start),
    lost: false,
    memberReactions: {},
    visitorReactions: {},
    reactionsCount: 1,
    commentsCount: 0,
    mine: null,
    clusterId,
  };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);
const cluster: RootsScope = { key: 'cluster:k1', set: { kind: 'cluster', clusterId: 'k1' } };
const area: RootsScope = { key: 'area:0-10', set: { kind: 'area', start: 0, end: 10 } };

function withPanels(scopes: RootsScope[]) {
  const queryClient = new QueryClient();

  for (const scope of scopes) {
    queryClient.setQueryData(rootsKey('m1', scope.key), {
      ...rootsPageOf({ items: [], nextCursor: null }),
      scope,
    });
  }
  queryClient.setQueryData(rootsKey('m1'), rootsPageOf({ items: [], nextCursor: null }));

  return queryClient;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedRoots.mockResolvedValue({ items: [], nextCursor: null });
  mockedPinned.mockResolvedValue(null);
  mockedFragments.mockResolvedValue([]);
});

describe('the top of a side panel', () => {
  it('asks the server only for the roots of its set, and its pin', async () => {
    mockedRoots.mockResolvedValue({ items: [comment('a', { fragmentId: 'f1' })], nextCursor: null });
    mockedPinned.mockResolvedValue(comment('pinned', { fragmentId: 'f1' }));

    const page = await loadRoots('m1', cluster);

    expect(mockedRoots).toHaveBeenCalledWith('m1', { set: cluster.set }, requestClient());
    expect(mockedPinned).toHaveBeenCalledWith('m1', cluster.set, requestClient());
    expect(ids(rootsInOrder(page))).toEqual(['pinned', 'a']);
    expect(page.scope).toEqual(cluster);
  });

  it('takes a new comment live — someone else’s too — when its fragment is in the set', async () => {
    const queryClient = withPanels([cluster, area]);

    queryClient.setQueryData(fragmentsKey('m1'), [
      fragment('f1', 2, 8, 'k1'),
      fragment('f2', 8, 30, 'k2'),
    ]);
    mockedByIds.mockResolvedValue([
      comment('in-cluster', { fragmentId: 'f1' }),
      comment('elsewhere', { fragmentId: 'f2' }),
      comment('plain'),
    ]);

    await syncComments(queryClient, 'm1', 'me', {
      added: ['in-cluster', 'elsewhere', 'plain'],
      changed: [],
    });

    expect(ids(rootsInOrder(readRoots(queryClient, 'm1', cluster.key)!))).toEqual(['in-cluster']);
    // f1 целиком в области, f2 — меньше чем наполовину.
    expect(ids(rootsInOrder(readRoots(queryClient, 'm1', area.key)!))).toEqual(['in-cluster']);
    // В общем шите чужой новый, как и раньше, — при следующем открытии.
    expect(rootsInOrder(readRoots(queryClient, 'm1')!)).toEqual([]);
  });

  it('reads the fragments afresh when a comment comes on a fragment it does not know', async () => {
    const queryClient = withPanels([cluster]);

    mockedFragments.mockResolvedValue([fragment('new', 3, 6, 'k1')]);
    mockedByIds.mockResolvedValue([comment('fresh', { fragmentId: 'new' })]);

    await syncComments(queryClient, 'm1', 'me', { added: ['fresh'], changed: [] });

    expect(ids(rootsInOrder(readRoots(queryClient, 'm1', cluster.key)!))).toEqual(['fresh']);
  });

  it('follows a new pin: each panel asks for the pin of its own set', async () => {
    const queryClient = withPanels([cluster]);

    mockedPinned.mockImplementation(async (_target, set) =>
      set ? null : comment('pinned', { fragmentId: 'f2' }),
    );

    await syncAuthorPin(queryClient, 'm1');

    expect(readRoots(queryClient, 'm1')?.authorPin?.id).toBe('pinned');
    expect(readRoots(queryClient, 'm1', cluster.key)?.authorPin).toBeNull();
  });
});
