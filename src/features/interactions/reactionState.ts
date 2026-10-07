// Чистая логика реакций: как выглядят счётчики с моей ещё не подтверждённой
// реакцией, что значит тап, в каком порядке показывать.

import {
  MAX_REACTORS,
  type MessageReactions,
  type MyReaction,
  type ReactionAudience,
  type ReactionCounts,
  type Reactor,
  type ReactorsByEmoji,
} from '@/api/reactionCounts';
import { ALL_REACTIONS } from '@/features/interactions/reactionSet';

/** Я как поставивший реакцию. */
export type Me = Pick<Reactor, 'userId' | 'name' | 'avatarUrl'>;

/**
 * Какой я хочу видеть свою реакцию: `emoji: null` — снять. `me` — я как
 * поставивший: с ним оптимистичная реакция сразу показывает мой аватар, а не
 * «1» до сверки.
 */
export type ReactionIntent = { emoji: string | null; audience: ReactionAudience; me?: Me };

/**
 * Сколько разных реакций держит ряд. Тот же инвариант — в базе
 * (`reaction_kinds_limit`, миграция `20261007120000_reaction_limits_and_reactors.sql`).
 */
export const REACTION_KINDS_LIMIT = { member: 20, visitor: 7, comment: 20 } as const;

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
 * Поставившие, в которых я — у `to`: из прежней реакции убран, к новой
 * дописан последним. Список значим только у реакций с одним-двумя
 * поставившими (`shownReactors`); у остальных под реакцией число.
 */
function moveMe(
  reactors: ReactorsByEmoji,
  from: MyReaction | null,
  to: MyReaction | null,
  me: Me,
): ReactorsByEmoji {
  const next: Record<string, readonly Reactor[]> = { ...reactors };

  if (from && next[from.emoji]) {
    const rest = next[from.emoji].filter((reactor) => reactor.userId !== me.userId);

    if (rest.length > 0) next[from.emoji] = rest;
    else delete next[from.emoji];
  }

  if (to) {
    const others = (next[to.emoji] ?? []).filter((reactor) => reactor.userId !== me.userId);

    next[to.emoji] = [...others, { ...me, audience: to.audience }];
  }

  return next;
}

/**
 * Счётчики, в которых моя реакция — `mine`: прежняя моя вычитается из своего
 * ряда, новая прибавляется к своему. Считается от того, что о моей реакции
 * уже знает база (`reactions.mine`), поэтому повтор ничего не удваивает.
 * С `me` и поставившие сразу такие, какими их отдаст сверка.
 */
export function replaceMine(
  reactions: MessageReactions,
  mine: MyReaction | null,
  me?: Me,
): MessageReactions {
  const current = reactions.mine;

  if (current?.emoji === mine?.emoji && current?.audience === mine?.audience) return reactions;

  let next = current ? adjust(reactions, current.audience, current.emoji, -1) : reactions;

  if (mine) next = adjust(next, mine.audience, mine.emoji, 1);

  return me?.userId
    ? { ...next, mine, reactors: moveMe(reactions.reactors ?? {}, current, mine, me) }
    : { ...next, mine };
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
    intent.me,
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

/** Ряд реакций в облачке: моя первой, дальше по популярности. */
export function rowOrder(counts: ReactionCounts, mine: string | null): [string, number][] {
  const sorted = byPopularity(counts);
  const index = mine === null ? -1 : sorted.findIndex(([emoji]) => emoji === mine);

  if (index <= 0) return sorted;

  return [sorted[index], ...sorted.slice(0, index), ...sorted.slice(index + 1)];
}

/** Общий ряд комментария: участники и зрители сложены. */
export function mergedCounts(reactions: MessageReactions): ReactionCounts {
  const visitors = Object.entries(reactions.visitors);

  if (visitors.length === 0) return reactions.members;

  const merged: Record<string, number> = { ...reactions.members };

  for (const [emoji, count] of visitors) merged[emoji] = (merged[emoji] ?? 0) + count;

  return merged;
}

/**
 * Кого рисовать под реакцией вместо числа: одного-двух поставивших, если
 * список сходится с числом. Не сходится (сверка ещё не пришла, кто-то снял) —
 * `null`, и под реакцией число. `audience` — чей ряд: у сообщения только
 * участники; без него — общий ряд комментария.
 */
export function shownReactors(
  reactions: MessageReactions,
  emoji: string,
  count: number,
  audience?: ReactionAudience,
): readonly Reactor[] | null {
  if (count > MAX_REACTORS) return null;

  const all = reactions.reactors?.[emoji] ?? [];
  const list = audience ? all.filter((reactor) => reactor.audience === audience) : all;

  return list.length === count ? list : null;
}

/** Ряд полон: новую разную реакцию база отвергнет — меню предлагает только уже стоящие. */
export function isRowFull(counts: ReactionCounts, limit: number): boolean {
  return Object.keys(counts).length >= limit;
}

/** Что меню реакций предлагает в моём ряду. */
export type MenuReactionSet = {
  /** Ряд полон — только уже стоящие, по популярности. Нет — весь набор. */
  options?: readonly string[];
  /** Сколько каждой уже стоит — у зрителя, чтобы видеть, к чему присоединиться. */
  counts?: ReactionCounts;
  /** Полный набор зрителей (7) влезает целиком — раскрывать нечего. */
  expandable: boolean;
};

/**
 * Набор меню по ряду, куда ляжет моя реакция: участника и зрителя у
 * сообщения, общий ряд у комментария. Ряд полон — новую разную база
 * отвергнет, и меню её не предлагает.
 */
export function menuReactionSet(
  reactions: MessageReactions,
  row: ReactionAudience | 'comment',
): MenuReactionSet {
  const counts =
    row === 'comment'
      ? mergedCounts(reactions)
      : row === 'member'
        ? reactions.members
        : reactions.visitors;
  const limit = REACTION_KINDS_LIMIT[row];
  const full = isRowFull(counts, limit);
  const options = full ? byPopularity(counts).map(([emoji]) => emoji) : undefined;

  if (row !== 'visitor') return { options, expandable: true };

  return {
    options,
    counts: Object.keys(counts).length > 0 ? counts : undefined,
    expandable: !full,
  };
}

export function hasReactions(reactions: MessageReactions): boolean {
  return Object.keys(reactions.members).length > 0 || Object.keys(reactions.visitors).length > 0;
}

function sameCounts(a: ReactionCounts, b: ReactionCounts): boolean {
  const keys = Object.keys(a);

  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function sameReactor(a: Reactor, b: Reactor): boolean {
  return (
    a.userId === b.userId &&
    a.audience === b.audience &&
    a.name === b.name &&
    a.avatarUrl === b.avatarUrl
  );
}

function sameReactors(a: ReactorsByEmoji = {}, b: ReactorsByEmoji = {}): boolean {
  const keys = Object.keys(a);

  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => {
      const left = a[key];
      const right = b[key];

      return (
        right !== undefined &&
        left.length === right.length &&
        left.every((reactor, index) => sameReactor(reactor, right[index]))
      );
    })
  );
}

/** Поставившие сравниваются тоже: иначе сверка не обновит аватары под реакциями. */
export function sameReactions(a: MessageReactions, b: MessageReactions): boolean {
  return (
    a.mine?.emoji === b.mine?.emoji &&
    a.mine?.audience === b.mine?.audience &&
    sameCounts(a.members, b.members) &&
    sameCounts(a.visitors, b.visitors) &&
    sameReactors(a.reactors, b.reactors)
  );
}
