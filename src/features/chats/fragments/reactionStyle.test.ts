import { clusterTone, dominantReaction, highlightIntensity } from './reactionStyle';

// Те же случаи, что в supabase/tests/fragment_cluster_dominant.sql: клиент
// считает лидера сам, пока база не ответила, и не должен с ней разойтись.
describe('dominantReaction', () => {
  it('picks the emoji with the most reactions', () => {
    expect(dominantReaction([{ '❤️': 24, '👍': 15, '🔥': 8 }], null)).toBe('❤️');
    expect(dominantReaction([{ '❤️': 12, '👍': 19, '🔥': 5 }], null)).toBe('👍');
  });

  it('adds members and visitors together', () => {
    expect(dominantReaction([{ '❤️': 3, '👍': 2 }, { '👍': 2 }], null)).toBe('👍');
  });

  it('keeps the previous leader in a tie until a rival is strictly ahead', () => {
    expect(dominantReaction([{ '❤️': 2, '👍': 2 }], '❤️')).toBe('❤️');
    expect(dominantReaction([{ '❤️': 2, '👍': 3 }], '❤️')).toBe('👍');
    expect(dominantReaction([{ '❤️': 2, '👍': 2 }], '👍')).toBe('👍');
  });

  it('breaks a tie without a previous leader by the reaction set order, every time', () => {
    expect(dominantReaction([{ '🔥': 2, '❤️': 2 }], null)).toBe('❤️');
    expect(dominantReaction([{ '❤️': 2, '🔥': 2 }], null)).toBe('❤️');
    expect(dominantReaction([{ '😮': 1, '😂': 1 }], null)).toBe('😂');
    expect(dominantReaction([{ '❤️': 1 }, { '👍': 1 }], '🔥')).toBe('👍');
  });

  it('has no leader without reactions', () => {
    expect(dominantReaction([{}, {}], null)).toBeNull();
    expect(dominantReaction([{}], '❤️')).toBeNull();
  });
});

describe('highlightIntensity', () => {
  const steps = [0, 1, 2, 5, 10, 30, 50, 100, 500];

  it('grows with the number of reactions and stops at the ceiling', () => {
    const values = steps.map(highlightIntensity);

    expect(values[0]).toBe(0);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    expect(highlightIntensity(500)).toBe(1);
  });

  it('changes a lot from 1 to 5 and barely from 50 to 500', () => {
    expect(highlightIntensity(5) - highlightIntensity(1)).toBeGreaterThan(0.2);
    expect(highlightIntensity(500) - highlightIntensity(50)).toBeLessThan(0.02);
  });
});

describe('clusterTone', () => {
  it('stays neutral without reactions', () => {
    expect(clusterTone({ dominant: null, reactionsCount: 0 }, 'light', false, 'gray')).toEqual({
      fill: 'gray',
      pattern: null,
    });
  });

  it('paints in the leader colour with its silhouettes', () => {
    const heart = clusterTone({ dominant: '❤️', reactionsCount: 3 }, 'light', false, 'gray');
    const like = clusterTone({ dominant: '👍', reactionsCount: 3 }, 'light', false, 'gray');

    expect(heart.pattern?.emoji).toBe('❤️');
    expect(heart.fill).not.toBe(like.fill);
  });

  it('paints any other emoji grey with its own silhouettes', () => {
    const thinking = clusterTone({ dominant: '🤔', reactionsCount: 3 }, 'light', false, 'gray');
    const clown = clusterTone({ dominant: '🤡', reactionsCount: 3 }, 'light', false, 'gray');

    expect(thinking.fill).toBe(clown.fill);
    expect(thinking.pattern?.emoji).toBe('🤔');
  });

  it('only gets more opaque with more reactions', () => {
    const alpha = (count: number) =>
      Number(/, ([\d.]+)\)$/.exec(clusterTone({ dominant: '🔥', reactionsCount: count }, 'dark', true, '')
        .fill)?.[1]);

    expect(alpha(30)).toBeGreaterThan(alpha(1));
    expect(alpha(1000)).toBe(alpha(50));
  });
});
