// Чистая логика реакций попа: один общий ряд, одна моя реакция.

import type { PopReactions } from '@/api/pops';
import type { ReactionCounts } from '@/api/reactionCounts';
import {
  byPopularity,
  REACTION_KINDS_LIMIT,
  type ReactionIntent,
} from '@/features/interactions/reactionState';

function add(counts: ReactionCounts, emoji: string, delta: number): ReactionCounts {
  const next = (counts[emoji] ?? 0) + delta;
  const { [emoji]: _dropped, ...rest } = counts;

  return next > 0 ? { ...rest, [emoji]: next } : rest;
}

/**
 * Счётчики, в которых моя реакция — `emoji` (`null` — снята). Считается от
 * того, что о моей реакции уже знает база (`mine`), поэтому повтор ничего не
 * удваивает.
 */
export function replacePopMine(reactions: PopReactions, emoji: string | null): PopReactions {
  if (reactions.mine === emoji) return reactions;

  let counts = reactions.mine ? add(reactions.counts, reactions.mine, -1) : reactions.counts;

  if (emoji) counts = add(counts, emoji, 1);

  return { counts, mine: emoji };
}

/** Реакции попа такими, какими станут, когда база примет моё желание. */
export function withPendingPopReaction(
  reactions: PopReactions,
  intent: ReactionIntent | undefined,
): PopReactions {
  return intent ? replacePopMine(reactions, intent.emoji) : reactions;
}

/** Тап по реакции в столбике: та же, что стоит, — снять; другая — поставить вместо. */
export function tappedPopReaction(reactions: PopReactions, tapped: string): string | null {
  return reactions.mine === tapped ? null : tapped;
}

/**
 * Двойной тап по видео — ❤️, только если моей реакции ещё нет. Стоит любая —
 * только анимация: двойной тап ничего не снимает и не меняет.
 */
export function doubleTapReaction(reactions: PopReactions, heart: string): string | null {
  return reactions.mine === null ? heart : null;
}

/** Столбик реакций попа: по убыванию числа, при равенстве — в порядке набора. */
export function popReactionColumn(reactions: PopReactions): [string, number][] {
  return byPopularity(reactions.counts);
}

/**
 * Что предлагает «+»: весь набор, а в полном ряду — только уже стоящие (новую
 * разную база не примет). Моя реакция, где я единственный, место освобождает.
 */
export function popPickerOptions(reactions: PopReactions): readonly string[] | undefined {
  const { counts, mine } = reactions;
  const freed = mine !== null && counts[mine] === 1 ? 1 : 0;
  const full = Object.keys(counts).length - freed >= REACTION_KINDS_LIMIT.pop;

  return full ? byPopularity(counts).map(([emoji]) => emoji) : undefined;
}
