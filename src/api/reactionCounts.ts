// Реакции в том виде, в каком их видит приложение, и разбор их из выборки
// сообщения. Без обращений к сети — как и `messagePreview.ts`: этим пользуются
// кеш истории и оптимистичные сообщения, которым клиент базы ни к чему.

import { opaqueFlag } from '@/api/opaquePeople';
import type { Json } from '@/api/types.gen';

/** Ряд реакции: участник чата или посетитель. */
export type ReactionAudience = 'member' | 'visitor';

/** Реакция → сколько людей её поставили. */
export type ReactionCounts = Readonly<Record<string, number>>;

export type MyReaction = { emoji: string; audience: ReactionAudience };

/**
 * Кто поставил реакцию — глазами смотрящего. `userId` null — аккаунт удалён;
 * `opaque` — человек подменён в диалоге, id непрозрачный, профиля нет.
 */
export type Reactor = {
  userId: string | null;
  audience: ReactionAudience;
  name: string | null;
  avatarUrl: string | null;
  opaque?: boolean;
};

/** Реакция → поставившие в порядке постановки. */
export type ReactorsByEmoji = Readonly<Record<string, readonly Reactor[]>>;

export type MessageReactions = {
  members: ReactionCounts;
  visitors: ReactionCounts;
  /** Моя реакция и её ряд. `null` — я реакцию не ставил. */
  mine: MyReaction | null;
  /**
   * Поставившие у реакций, которые поставили один-два человека (вычисляемая
   * связь `reactors`): у сообщения — только участники, у комментария — оба
   * ряда. У остальных реакций списка нет — под ними число.
   */
  reactors?: ReactorsByEmoji;
};

export const NO_REACTIONS: MessageReactions = {
  members: {},
  visitors: {},
  mine: null,
  reactors: {},
};

/** Колонки реакций в выборке сообщения или комментария. */
export const REACTION_COLUMNS =
  'member_reactions, visitor_reactions, my_reaction(emoji, audience), reactors(emoji, user_id, audience, updated_at, display_name, avatar_url, opaque)';

/** Больше двух поставивших под реакцией не рисуется — там число. */
export const MAX_REACTORS = 2;

export function toAudience(value: string): ReactionAudience {
  return value === 'member' ? 'member' : 'visitor';
}

/** jsonb «реакция → число» из базы. Всё, что не похоже на положительное число, отбрасывается. */
export function toReactionCounts(value: Json): ReactionCounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const counts: Record<string, number> = {};

  for (const [emoji, count] of Object.entries(value)) {
    if (typeof count === 'number' && count > 0) counts[emoji] = count;
  }

  return counts;
}

type ReactorRow = {
  emoji: string;
  user_id: string | null;
  audience: string;
  updated_at: string;
  display_name: string | null;
  avatar_url: string | null;
  opaque: boolean | null;
};

/** Порядок постановки — по времени, а не по порядку строк в ответе: его PostgREST не обещает. */
function toReactors(rows: readonly ReactorRow[] | null | undefined): ReactorsByEmoji {
  if (!rows || rows.length === 0) return {};

  const sorted = [...rows].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const byEmoji: Record<string, Reactor[]> = {};

  for (const row of sorted) {
    const list = (byEmoji[row.emoji] ??= []);

    if (list.length < MAX_REACTORS) {
      list.push({
        userId: row.user_id,
        audience: toAudience(row.audience),
        name: row.display_name ?? null,
        avatarUrl: row.avatar_url ?? null,
        opaque: opaqueFlag(row.user_id, row.opaque),
      });
    }
  }

  return byEmoji;
}

type ReactionRow = {
  member_reactions: Json;
  visitor_reactions: Json;
  my_reaction: { emoji: string; audience: string } | null;
  reactors?: readonly ReactorRow[] | null;
};

export function toReactions(row: ReactionRow): MessageReactions {
  const members = toReactionCounts(row.member_reactions);
  const visitors = toReactionCounts(row.visitor_reactions);

  if (!row.my_reaction && Object.keys(members).length === 0 && Object.keys(visitors).length === 0) {
    return NO_REACTIONS;
  }

  return {
    members,
    visitors,
    mine: row.my_reaction
      ? { emoji: row.my_reaction.emoji, audience: toAudience(row.my_reaction.audience) }
      : null,
    reactors: toReactors(row.reactors),
  };
}
