import {
  doubleTapReaction,
  popPickerOptions,
  popReactionColumn,
  replacePopMine,
  tappedPopReaction,
  withPendingPopReaction,
} from './popReactions';

import { ALL_REACTIONS } from '@/features/interactions/reactionSet';

describe('pop reactions', () => {
  it('puts my reaction, swaps it for another and takes it off — counts stay consistent', () => {
    const start = { counts: { '😁': 2 }, mine: null };
    const fire = replacePopMine(start, '🔥');

    expect(fire).toEqual({ counts: { '😁': 2, '🔥': 1 }, mine: '🔥' });
    expect(replacePopMine(fire, '😁')).toEqual({ counts: { '😁': 3 }, mine: '😁' });
    expect(replacePopMine(fire, null)).toEqual({ counts: { '😁': 2 }, mine: null });
    expect(replacePopMine(fire, '🔥')).toBe(fire);
  });

  it('shows a pending reaction on top of what the server knows', () => {
    const known = { counts: { '👍': 1 }, mine: '👍' };

    expect(withPendingPopReaction(known, undefined)).toBe(known);
    expect(withPendingPopReaction(known, { emoji: null, audience: 'visitor' })).toEqual({
      counts: {},
      mine: null,
    });
  });

  it('tap on my reaction takes it off, on another — puts that one instead', () => {
    const reactions = { counts: { '👍': 1, '🔥': 1 }, mine: '👍' };

    expect(tappedPopReaction(reactions, '👍')).toBeNull();
    expect(tappedPopReaction(reactions, '🔥')).toBe('🔥');
  });

  it('double tap puts ❤️ only when I have no reaction, and never changes or removes one', () => {
    expect(doubleTapReaction({ counts: {}, mine: null }, '❤️')).toBe('❤️');
    expect(doubleTapReaction({ counts: { '❤️': 1 }, mine: '❤️' }, '❤️')).toBeNull();
    expect(doubleTapReaction({ counts: { '😁': 1 }, mine: '😁' }, '❤️')).toBeNull();
  });

  it('orders the column by count, ties in set order', () => {
    expect(popReactionColumn({ counts: { '🔥': 1, '👍': 1, '😁': 5 }, mine: null })).toEqual([
      ['😁', 5],
      ['👍', 1],
      ['🔥', 1],
    ]);
  });

  it('offers the whole set until 20 kinds, then only those already there', () => {
    const counts = Object.fromEntries(ALL_REACTIONS.slice(0, 20).map((emoji) => [emoji, 2]));

    expect(popPickerOptions({ counts: { '👍': 1 }, mine: null })).toBeUndefined();
    expect(popPickerOptions({ counts, mine: null })).toHaveLength(20);
    // Я единственный у своей — её место освобождается, весь набор снова доступен.
    expect(
      popPickerOptions({ counts: { ...counts, [ALL_REACTIONS[0]]: 1 }, mine: ALL_REACTIONS[0] }),
    ).toBeUndefined();
  });
});
