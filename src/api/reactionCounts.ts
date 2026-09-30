// Реакции в том виде, в каком их видит приложение, и разбор их из выборки
// сообщения. Без обращений к сети — как и `messagePreview.ts`: этим пользуются
// кеш истории и оптимистичные сообщения, которым клиент базы ни к чему.

import type { Json } from '@/api/types.gen';

/** Ряд реакции: участник чата или посетитель. */
export type ReactionAudience = 'member' | 'visitor';

/** Реакция → сколько людей её поставили. */
export type ReactionCounts = Readonly<Record<string, number>>;

export type MyReaction = { emoji: string; audience: ReactionAudience };

export type MessageReactions = {
  members: ReactionCounts;
  visitors: ReactionCounts;
  /** Моя реакция и её ряд. `null` — я реакцию не ставил. */
  mine: MyReaction | null;
};

export const NO_REACTIONS: MessageReactions = { members: {}, visitors: {}, mine: null };

/** Колонки реакций в выборке сообщения. */
export const REACTION_COLUMNS = 'member_reactions, visitor_reactions, my_reaction(emoji, audience)';

export function toAudience(value: string): ReactionAudience {
  return value === 'member' ? 'member' : 'visitor';
}

/** jsonb «реакция → число» из базы. Всё, что не похоже на положительное число, отбрасывается. */
function toCounts(value: Json): ReactionCounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const counts: Record<string, number> = {};

  for (const [emoji, count] of Object.entries(value)) {
    if (typeof count === 'number' && count > 0) counts[emoji] = count;
  }

  return counts;
}

type ReactionRow = {
  member_reactions: Json;
  visitor_reactions: Json;
  my_reaction: { emoji: string; audience: string } | null;
};

export function toReactions(row: ReactionRow): MessageReactions {
  const members = toCounts(row.member_reactions);
  const visitors = toCounts(row.visitor_reactions);

  if (!row.my_reaction && Object.keys(members).length === 0 && Object.keys(visitors).length === 0) {
    return NO_REACTIONS;
  }

  return {
    members,
    visitors,
    mine: row.my_reaction
      ? { emoji: row.my_reaction.emoji, audience: toAudience(row.my_reaction.audience) }
      : null,
  };
}
