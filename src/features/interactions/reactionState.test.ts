import { byPopularity, nextReaction, replaceMine, withMyReaction } from './reactionState';

import type { MessageReactions } from '@/api/reactionCounts';

const base: MessageReactions = {
  members: { '👍': 2, '🔥': 1 },
  visitors: { '😁': 3 },
  mine: null,
};

describe('nextReaction', () => {
  it('sets a reaction, replaces another one and takes the same one off', () => {
    expect(nextReaction(null, '👍')).toBe('👍');
    expect(nextReaction({ emoji: '🔥', audience: 'member' }, '👍')).toBe('👍');
    expect(nextReaction({ emoji: '👍', audience: 'member' }, '👍')).toBeNull();
  });
});

describe('withMyReaction', () => {
  it('adds my reaction to my row', () => {
    const next = withMyReaction(base, { emoji: '👍', audience: 'member' });

    expect(next.members).toEqual({ '👍': 3, '🔥': 1 });
    expect(next.visitors).toEqual({ '😁': 3 });
    expect(next.mine).toEqual({ emoji: '👍', audience: 'member' });
  });

  it('puts a visitor reaction into the visitors row only', () => {
    const next = withMyReaction(base, { emoji: '👍', audience: 'visitor' });

    expect(next.members).toEqual(base.members);
    expect(next.visitors).toEqual({ '😁': 3, '👍': 1 });
  });

  it('moves my reaction from one emoji to another', () => {
    const mine: MessageReactions = { ...base, mine: { emoji: '🔥', audience: 'member' } };
    const next = withMyReaction(mine, { emoji: '👍', audience: 'member' });

    expect(next.members).toEqual({ '👍': 3 });
  });

  it('takes my reaction off and drops an emptied emoji', () => {
    const mine: MessageReactions = { ...base, mine: { emoji: '🔥', audience: 'member' } };
    const next = withMyReaction(mine, { emoji: null, audience: 'member' });

    expect(next.members).toEqual({ '👍': 2 });
    expect(next.mine).toBeNull();
  });

  it('counts nothing twice once the server already has my reaction', () => {
    const confirmed: MessageReactions = {
      members: { '👍': 3 },
      visitors: {},
      mine: { emoji: '👍', audience: 'member' },
    };

    expect(withMyReaction(confirmed, { emoji: '👍', audience: 'member' })).toBe(confirmed);
  });

  it('changing a reaction left in the visitors row moves it into my row now', () => {
    // Посетитель стал участником: старая реакция — у зрителей, новая — у участников.
    const joined: MessageReactions = {
      members: {},
      visitors: { '😁': 1 },
      mine: { emoji: '😁', audience: 'visitor' },
    };
    const next = withMyReaction(joined, { emoji: '🔥', audience: 'member' });

    expect(next.visitors).toEqual({});
    expect(next.members).toEqual({ '🔥': 1 });
  });
});

describe('replaceMine', () => {
  it('takes the row the server answered with', () => {
    const guessed = withMyReaction(base, { emoji: '👍', audience: 'visitor' });
    const settled = replaceMine(guessed, { emoji: '👍', audience: 'member' });

    expect(settled.visitors).toEqual({ '😁': 3 });
    expect(settled.members).toEqual({ '👍': 3, '🔥': 1 });
  });
});

describe('byPopularity', () => {
  it('orders by count, then by the reaction set so equal chips do not swap', () => {
    expect(byPopularity({ '🔥': 1, '😁': 5, '👍': 1 })).toEqual([
      ['😁', 5],
      ['👍', 1],
      ['🔥', 1],
    ]);
  });
});
