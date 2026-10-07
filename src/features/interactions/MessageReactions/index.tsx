import { useCallback, useMemo } from 'react';

import { MemberReactionRow } from './MemberReactionRow';
import type { ShownPerson } from './ReactionBadge';
import type { ReactionsTone } from './tones';
import { VisitorReactionLine } from './VisitorReactionLine';

import type { MessageReactions as Reactions, ReactionAudience } from '@/api/reactionCounts';
import {
  byPopularity,
  mergedCounts,
  rowOrder,
  shownReactors,
} from '@/features/interactions/reactionState';

export type { ReactionsTone } from './tones';
export { resetScrolledRows, scrolledRowsCount } from './rowMemory';

/**
 * Как реакции разложены по облачку: у сообщения — ряд участников и строка
 * зрителей отдельно, у комментария — один общий ряд.
 */
export type ReactionsLayout = 'split' | 'merged';

/** Свежие имя и фото человека — из участников чата, если он там есть. */
export type ResolvePerson = (
  userId: string,
) => { name: string; avatarUrl: string | null } | undefined;

export type BubbleReactionsProps = {
  /** Ключ памяти рядов (сдвиг, масштаб): у облачка и его копии один. */
  memoryKey: string;
  reactions: Reactions;
  tone: ReactionsTone;
  layout: ReactionsLayout;
  /** Мой ряд у сообщения: тап ставит и снимает реакцию только в ряду участников, если я участник. */
  audience?: ReactionAudience;
  /** Нет обработчика — копия облачка: ничего не нажимается и не прокручивается. */
  onToggle?: (emoji: string) => void;
  resolvePerson?: ResolvePerson;
};

/** Реакции крупного ряда в порядке показа: моя первой, дальше по популярности. */
export function largeRowEntries(reactions: Reactions, layout: ReactionsLayout): [string, number][] {
  const { mine } = reactions;

  if (layout === 'merged') return rowOrder(mergedCounts(reactions), mine?.emoji ?? null);

  return rowOrder(reactions.members, mine?.audience === 'member' ? mine.emoji : null);
}

/**
 * Крупный ряд: у сообщения — реакции участников, у комментария — все. Нет
 * реакций — ничего, и места под ряд в строке нет.
 */
export function LargeReactionRow({
  memoryKey,
  reactions,
  tone,
  layout,
  audience,
  onToggle,
  resolvePerson,
}: BubbleReactionsProps) {
  const entries = useMemo(() => largeRowEntries(reactions, layout), [layout, reactions]);
  const { mine } = reactions;
  const mineHere =
    layout === 'merged' || mine?.audience === 'member' ? (mine?.emoji ?? null) : null;
  // У сообщения ряд участников нажимает только участник; общий ряд комментария — любой.
  const canTap = Boolean(onToggle) && (layout === 'merged' || audience === 'member');

  const peopleOf = useCallback(
    (emoji: string, count: number): ShownPerson[] | null => {
      const reactors = shownReactors(
        reactions,
        emoji,
        count,
        layout === 'split' ? 'member' : undefined,
      );

      return (
        reactors?.map((reactor, index) => {
          const fresh = reactor.userId ? resolvePerson?.(reactor.userId) : undefined;

          return {
            key: reactor.userId ?? `deleted-${index}`,
            // Аккаунт удалён — заглушка без фото.
            name: fresh?.name ?? reactor.name ?? '',
            avatarUrl: fresh ? fresh.avatarUrl : reactor.avatarUrl,
          };
        }) ?? null
      );
    },
    [layout, reactions, resolvePerson],
  );

  if (entries.length === 0) return null;

  return (
    <MemberReactionRow
      memoryKey={memoryKey}
      entries={entries}
      mine={mineHere}
      peopleOf={peopleOf}
      tone={tone}
      onToggle={canTap ? onToggle : undefined}
      swallowsTouch={Boolean(onToggle)}
      frozen={!onToggle}
    />
  );
}

/** Строка зрителей — только у сообщения. Нет реакций зрителей — нет и строки. */
export function VisitorReactions({ memoryKey, reactions, tone, layout }: BubbleReactionsProps) {
  const entries = useMemo(() => byPopularity(reactions.visitors), [reactions.visitors]);
  const { mine } = reactions;

  if (layout === 'merged' || entries.length === 0) return null;

  return (
    <VisitorReactionLine
      memoryKey={memoryKey}
      entries={entries}
      mine={mine?.audience === 'visitor' ? mine.emoji : null}
      tone={tone}
    />
  );
}
