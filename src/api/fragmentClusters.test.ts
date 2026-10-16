import { listMessageClusters } from './fragmentClusters';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const mockedRpc = jest.mocked(supabase.rpc);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    message_id: 'm1',
    start_offset: 3,
    end_offset: 8,
    display_start: 3,
    display_end: 8,
    display_text: 'Огонь',
    popularity: 2.5,
    member_reactions: { '❤️': 1 },
    visitor_reactions: { '🔥': 2 },
    reactions_count: 3,
    comments_count: 4,
    people_count: 3,
    fragments_count: 5,
    my_emoji: '🔥',
    my_fragment_id: 'f2',
    decision_id: 'd1',
    ...overrides,
  };
}

function answer(rows: unknown[]) {
  mockedRpc.mockResolvedValue({ data: rows, error: null } as never);
}

describe('listMessageClusters', () => {
  it('turns a cluster row into the highlighted range of the bubble text, counters and my reaction', async () => {
    // Два эмодзи до «Огонь»: в базе это 2 code points, в UTF-16 — 4 символа.
    const text = '🔥🔥 Огонь 👍🏽 класс';

    answer([row()]);

    const [cluster] = await listMessageClusters('m1', text);

    expect(mockedRpc).toHaveBeenCalledWith('list_message_clusters', { target_message: 'm1' });
    expect(cluster).toEqual({
      id: 'k1',
      messageId: 'm1',
      start: 5,
      end: 10,
      quote: 'Огонь',
      popularity: 2.5,
      memberReactions: { '❤️': 1 },
      visitorReactions: { '🔥': 2 },
      reactionsCount: 3,
      commentsCount: 4,
      peopleCount: 3,
      fragmentsCount: 5,
      mine: '🔥',
      myFragmentId: 'f2',
      decisionId: 'd1',
    });
    expect(text.slice(cluster.start, cluster.end)).toBe('Огонь');
  });

  it('has no reaction of mine when I did not react in the cluster', async () => {
    answer([row({ my_emoji: null, my_fragment_id: null })]);

    const [cluster] = await listMessageClusters('m1', '🔥🔥 Огонь');

    expect(cluster.mine).toBeNull();
    expect(cluster.myFragmentId).toBeNull();
  });

  it('skips a cluster whose piece is not in this text — the bubble lags behind an edit', async () => {
    answer([row(), row({ id: 'k2', display_start: 11, display_end: 16, display_text: 'класс' })]);

    const clusters = await listMessageClusters('m1', '🔥🔥 Огонь 👍🏽 ой');

    expect(clusters.map((c) => c.id)).toEqual(['k1']);
  });

  it('passes the server error on', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: new Error('boom') } as never);

    await expect(listMessageClusters('m1', 'текст')).rejects.toThrow('boom');
  });
});
