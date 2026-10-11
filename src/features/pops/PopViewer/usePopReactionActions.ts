import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { HEART } from './HeartBurst';

import type { Pop } from '@/api/pops';
import { readPendingReaction } from '@/features/interactions/pendingReactions';
import { sendReaction } from '@/features/interactions/reactionSender';
import { audienceOf } from '@/features/interactions/reactionState';
import { doubleTapReaction, withPendingPopReaction } from '@/features/pops/popReactions';

/**
 * Реакции просмотра: поставить выбранную и ❤️ двойным тапом. Обе — общей
 * очередью реакций, оптимистично. Ряд угадывается по праву публиковать, но
 * решает его база.
 */
export function usePopReactionActions(canPublish: boolean) {
  const queryClient = useQueryClient();
  const audience = audienceOf(canPublish);

  const onReaction = useCallback(
    (pop: Pop, emoji: string | null) =>
      sendReaction(queryClient, pop.id, { emoji, audience }, 'pop'),
    [audience, queryClient],
  );

  // ❤️ — только если моей реакции нет; стоит любая — только анимация.
  const onDoubleTap = useCallback(
    (pop: Pop) => {
      const shown = withPendingPopReaction(pop.reactions, readPendingReaction(pop.id));
      const emoji = doubleTapReaction(shown, HEART);

      if (emoji) sendReaction(queryClient, pop.id, { emoji, audience }, 'pop');
    },
    [audience, queryClient],
  );

  return { onReaction, onDoubleTap };
}
