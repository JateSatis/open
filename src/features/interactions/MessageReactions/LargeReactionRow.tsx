import { useCallback, useMemo } from 'react';

import { MemberReactionRow } from './MemberReactionRow';
import type { ShownPerson } from './ReactionBadge';
import { isMergedLayout, type BubbleReactionsProps, type ReactionsLayout } from './types';

import type { MessageReactions as Reactions } from '@/api/reactionCounts';
import { mergedCounts, rowOrder, shownReactors } from '@/features/interactions/reactionState';

/** Реакции крупного ряда в порядке показа: моя первой, дальше по популярности. */
function largeRowEntries(reactions: Reactions, layout: ReactionsLayout): [string, number][] {
  const { mine } = reactions;

  if (isMergedLayout(layout)) return rowOrder(mergedCounts(reactions), mine?.emoji ?? null);

  return rowOrder(reactions.members, mine?.audience === 'member' ? mine.emoji : null);
}

/**
 * Крупный ряд: у сообщения — реакции участников, у комментария и поста
 * канала — все. Нет реакций — ничего, и места под ряд нет.
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
  const merged = isMergedLayout(layout);
  const mineHere = merged || mine?.audience === 'member' ? (mine?.emoji ?? null) : null;
  // У сообщения ряд участников нажимает только участник; общий ряд — любой.
  const canTap = Boolean(onToggle) && (merged || audience === 'member');

  const peopleOf = useCallback(
    (emoji: string, count: number): ShownPerson[] | null => {
      // Пост канала: аватаров нет никогда — одна реакция без подписи, дальше число.
      if (layout === 'mergedCounts') return count === 1 ? [] : null;

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
