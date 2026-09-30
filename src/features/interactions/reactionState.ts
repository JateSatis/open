// Чистая логика реакций: как выглядят счётчики с моей ещё не подтверждённой
// реакцией, что значит тап, в каком порядке показывать.

import type {
  MessageReactions,
  MyReaction,
  ReactionAudience,
  ReactionCounts,
} from '@/api/reactionCounts';
import { ALL_REACTIONS } from '@/features/interactions/reactionSet';

/** Какой я хочу видеть свою реакцию: `emoji: null` — снять. */
export type ReactionIntent = { emoji: string | null; audience: ReactionAudience };

/** В какой ряд попадёт моя реакция, если поставить её сейчас. Решает база; это — её же правило. */
export function audienceOf(isMember: boolean): ReactionAudience {
  return isMember ? 'member' : 'visitor';
}

/**
 * Тап по реакции: та же, что стоит, — снять; любая другая — поставить
 * вместо неё. Одна реакция на человека.
 */
export function nextReaction(mine: MyReaction | null, tapped: string): string | null {
  return mine?.emoji === tapped ? null : tapped;
}

function add(counts: ReactionCounts, emoji: string, delta: number): ReactionCounts {
  const next = (counts[emoji] ?? 0) + delta;
  const { [emoji]: _dropped, ...rest } = counts;

  return next > 0 ? { ...rest, [emoji]: next } : rest;
}

function adjust(
  reactions: MessageReactions,
  audience: ReactionAudience,
  emoji: string,
  delta: number,
): MessageReactions {
  return audience === 'member'
    ? { ...reactions, members: add(reactions.members, emoji, delta) }
    : { ...reactions, visitors: add(reactions.visitors, emoji, delta) };
}

/**
 * Счётчики, в которых моя реакция — `mine`: прежняя моя вычитается из своего
 * ряда, новая прибавляется к своему. Считается от того, что о моей реакции
 * уже знает база (`reactions.mine`), поэтому повтор ничего не удваивает.
 */
export function replaceMine(
  reactions: MessageReactions,
  mine: MyReaction | null,
): MessageReactions {
  const current = reactions.mine;

  if (current?.emoji === mine?.emoji && current?.audience === mine?.audience) return reactions;

  let next = current ? adjust(reactions, current.audience, current.emoji, -1) : reactions;

  if (mine) next = adjust(next, mine.audience, mine.emoji, 1);

  return { ...next, mine };
}

/**
 * Счётчики такими, какими они станут, когда база примет моё желание. Та же
 * реакция, что уже стоит, — без изменений: её ряд остаётся прежним, пока
 * реакцию не поменяют.
 */
export function withMyReaction(
  reactions: MessageReactions,
  intent: ReactionIntent,
): MessageReactions {
  if ((reactions.mine?.emoji ?? null) === intent.emoji) return reactions;

  return replaceMine(
    reactions,
    intent.emoji === null ? null : { emoji: intent.emoji, audience: intent.audience },
  );
}

const ORDER = new Map(ALL_REACTIONS.map((emoji, index) => [emoji, index]));

/** Ряд по популярности; при равенстве — в порядке набора, чтобы чипы не менялись местами. */
export function byPopularity(counts: ReactionCounts): [string, number][] {
  return Object.entries(counts).sort(
    ([a, countA], [b, countB]) =>
      countB - countA || (ORDER.get(a) ?? ORDER.size) - (ORDER.get(b) ?? ORDER.size),
  );
}

export function hasReactions(reactions: MessageReactions): boolean {
  return Object.keys(reactions.members).length > 0 || Object.keys(reactions.visitors).length > 0;
}

function sameCounts(a: ReactionCounts, b: ReactionCounts): boolean {
  const keys = Object.keys(a);

  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

export function sameReactions(a: MessageReactions, b: MessageReactions): boolean {
  return (
    a.mine?.emoji === b.mine?.emoji &&
    a.mine?.audience === b.mine?.audience &&
    sameCounts(a.members, b.members) &&
    sameCounts(a.visitors, b.visitors)
  );
}
