import { useMemo } from 'react';

import type { BubbleReactionsProps } from './types';
import { VisitorReactionLine } from './VisitorReactionLine';

import { byPopularity } from '@/features/interactions/reactionState';

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
