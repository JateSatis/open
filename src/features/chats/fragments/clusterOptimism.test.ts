import { QueryClient } from '@tanstack/react-query';

import { patchClusterReaction } from './clusterOptimism';

import type { FragmentCluster } from '@/api/fragmentClusters';
import { clustersKey } from '@/features/chats/fragments/clusterKeys';

function cluster(overrides: Partial<FragmentCluster>): FragmentCluster {
  return {
    id: 'k1',
    messageId: 'm1',
    start: 0,
    end: 5,
    quote: 'текст',
    popularity: 1,
    memberReactions: {},
    visitorReactions: {},
    reactionsCount: 0,
    commentsCount: 0,
    peopleCount: 0,
    fragmentsCount: 1,
    mine: null,
    myFragmentId: null,
    decisionId: null,
    dominant: null,
    ...overrides,
  };
}

function setup(initial: FragmentCluster) {
  const queryClient = new QueryClient();
  const key = clustersKey('m1', 'текст и дальше');

  queryClient.setQueryData(key, [initial]);

  return {
    react: (emoji: string | null, audience: 'member' | 'visitor' = 'member') =>
      patchClusterReaction(queryClient, {
        messageId: 'm1',
        clusterId: 'k1',
        emoji,
        range: { start: 0, end: 5 },
        audience,
      }),
    current: () => queryClient.getQueryData<FragmentCluster[]>(key)?.[0],
  };
}

describe('patchClusterReaction leader', () => {
  it('keeps the previous leader when my reaction makes a tie', () => {
    const { react, current } = setup(
      cluster({ memberReactions: { '❤️': 1 }, reactionsCount: 1, dominant: '❤️' }),
    );

    react('👍', 'visitor');

    expect(current()).toMatchObject({ visitorReactions: { '👍': 1 }, dominant: '❤️' });
  });

  it('switches the colour at once when my reaction puts a rival ahead', () => {
    const { react, current } = setup(
      cluster({ memberReactions: { '❤️': 1, '👍': 1 }, reactionsCount: 2, dominant: '❤️' }),
    );

    react('👍');

    expect(current()?.dominant).toBe('👍');
  });

  it('goes neutral when my reaction was the last one', () => {
    const { react, current } = setup(
      cluster({ memberReactions: { '🔥': 1 }, reactionsCount: 1, mine: '🔥', dominant: '🔥' }),
    );

    react(null);

    expect(current()).toMatchObject({ reactionsCount: 0, dominant: null });
  });

  it('starts a leader on a cluster held by comments only', () => {
    const { react, current } = setup(cluster({ commentsCount: 2 }));

    react('😂');

    expect(current()?.dominant).toBe('😂');
  });
});
