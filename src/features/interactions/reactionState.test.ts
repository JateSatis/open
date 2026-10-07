import {
  byPopularity,
  isRowFull,
  menuReactionSet,
  mergedCounts,
  nextReaction,
  replaceMine,
  rowOrder,
  sameReactions,
  shownReactors,
  withMyReaction,
} from './reactionState';

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

describe('rowOrder', () => {
  it('puts my reaction first, the rest by popularity', () => {
    expect(rowOrder({ '👍': 5, '🔥': 3, '😁': 1 }, '😁').map(([emoji]) => emoji)).toEqual([
      '😁',
      '👍',
      '🔥',
    ]);
  });

  it('keeps plain popularity when my reaction is not in the row', () => {
    expect(rowOrder({ '👍': 1, '🔥': 3 }, '😁').map(([emoji]) => emoji)).toEqual(['🔥', '👍']);
  });
});

describe('mergedCounts', () => {
  it('adds visitors to members for the one row of a comment', () => {
    expect(mergedCounts(base)).toEqual({ '👍': 2, '🔥': 1, '😁': 3 });
    expect(mergedCounts({ ...base, visitors: { '👍': 1 } })).toEqual({ '👍': 3, '🔥': 1 });
  });
});

const me = { userId: 'me', name: 'Я', avatarUrl: 'me.jpg' };
const ann = { userId: 'ann', audience: 'member' as const, name: 'Аня', avatarUrl: null };

describe('shownReactors', () => {
  it('shows people only when the list matches the count', () => {
    const reactions: MessageReactions = { ...base, reactors: { '👍': [ann], '🔥': [ann] } };

    expect(shownReactors(reactions, '🔥', 1, 'member')).toEqual([ann]);
    // Двое поставили, а знаем одного — число.
    expect(shownReactors(reactions, '👍', 2, 'member')).toBeNull();
    expect(shownReactors(reactions, '👍', 3, 'member')).toBeNull();
  });

  it('a message row shows only its members, a comment row everyone', () => {
    const guest = { ...ann, userId: 'guest', audience: 'visitor' as const };
    const reactions: MessageReactions = { ...base, reactors: { '👍': [ann, guest] } };

    expect(shownReactors(reactions, '👍', 1, 'member')).toEqual([ann]);
    expect(shownReactors(reactions, '👍', 2)).toEqual([ann, guest]);
  });
});

describe('my reaction among reactors', () => {
  it('an optimistic reaction shows me right away, in order of placing', () => {
    const reactions: MessageReactions = { ...base, reactors: { '🔥': [ann] } };
    const next = withMyReaction(reactions, { emoji: '🔥', audience: 'member', me });

    expect(next.members['🔥']).toBe(2);
    expect(shownReactors(next, '🔥', 2, 'member')).toEqual([ann, { ...me, audience: 'member' }]);
  });

  it('moving my reaction takes me off the old one', () => {
    const reactions: MessageReactions = {
      ...base,
      members: { '🔥': 2 },
      mine: { emoji: '🔥', audience: 'member' },
      reactors: { '🔥': [ann, { ...me, audience: 'member' }] },
    };
    const next = replaceMine(reactions, { emoji: '👍', audience: 'member' }, me);

    expect(next.reactors).toEqual({ '🔥': [ann], '👍': [{ ...me, audience: 'member' }] });
  });

  it('a sync with other people is not the same reactions', () => {
    const before: MessageReactions = { ...base, reactors: { '🔥': [ann] } };
    const after: MessageReactions = {
      ...base,
      reactors: { '🔥': [{ ...ann, avatarUrl: 'new.jpg' }] },
    };

    expect(sameReactions(before, after)).toBe(false);
    expect(sameReactions(before, { ...before })).toBe(true);
  });
});

describe('isRowFull', () => {
  it('is full at the limit of different reactions', () => {
    expect(isRowFull({ a: 1, b: 2 }, 2)).toBe(true);
    expect(isRowFull({ a: 1 }, 2)).toBe(false);
  });
});

describe('menuReactionSet', () => {
  const kinds = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, index) => [`e${index}`, n - index]));

  it('offers the whole set while the row has room', () => {
    expect(menuReactionSet({ ...base, members: kinds(19) }, 'member')).toEqual({
      options: undefined,
      expandable: true,
    });
  });

  it('a full members row offers only its 20 reactions, by popularity', () => {
    const set = menuReactionSet({ ...base, members: kinds(20) }, 'member');

    expect(set.options).toHaveLength(20);
    expect(set.options?.[0]).toBe('e0');
    expect(set.counts).toBeUndefined();
    expect(set.expandable).toBe(true);
  });

  it('a visitor sees counts, and a full visitors row of 7 opens without expanding', () => {
    expect(menuReactionSet(base, 'visitor')).toEqual({
      options: undefined,
      counts: { '😁': 3 },
      expandable: true,
    });

    const full = menuReactionSet({ ...base, visitors: kinds(7) }, 'visitor');

    expect(full.options).toHaveLength(7);
    expect(full.expandable).toBe(false);
  });

  it('a member is not limited by the visitors row', () => {
    expect(menuReactionSet({ ...base, visitors: kinds(7) }, 'member').options).toBeUndefined();
  });

  it('a comment counts both rows together, without numbers', () => {
    const set = menuReactionSet(
      { ...base, members: kinds(10), visitors: { a: 1, ...kinds(10) } },
      'comment',
    );

    expect(set.options).toBeUndefined();

    const full = menuReactionSet(
      {
        ...base,
        members: kinds(10),
        visitors: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`v${i}`, 1])),
      },
      'comment',
    );

    expect(full.options).toHaveLength(20);
    expect(full.counts).toBeUndefined();
  });
});
