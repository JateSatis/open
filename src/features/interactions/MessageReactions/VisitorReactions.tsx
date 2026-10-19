import { useMemo } from 'react';

import { isMergedLayout, type BubbleReactionsProps } from './types';
import { VisitorReactionLine } from './VisitorReactionLine';

import { byPopularity } from '@/features/interactions/reactionState';

/** Реакции зрителей — только у сообщения. Нет реакций зрителей — нет и строки. */
export function VisitorReactions({
  memoryKey,
  reactions,
  tone,
  layout,
  onToggle,
}: BubbleReactionsProps) {
  const entries = useMemo(() => byPopularity(reactions.visitors), [reactions.visitors]);
  const { mine } = reactions;

  if (isMergedLayout(layout) || entries.length === 0) return null;

  return (
    <VisitorReactionLine
      // Сдвиг строки зрителей помнится отдельно от ряда участников того же облачка.
      memoryKey={`${memoryKey}/visitors`}
      entries={entries}
      mine={mine?.audience === 'visitor' ? mine.emoji : null}
      tone={tone}
      // Без обработчика — копия облачка (как у крупного ряда).
      frozen={!onToggle}
    />
  );
}
