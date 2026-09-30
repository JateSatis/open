import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { MessageReactions, ReactionAudience } from '@/api/reactionCounts';
import { sendReaction } from '@/features/interactions/reactionSender';
import { audienceOf, nextReaction } from '@/features/interactions/reactionState';

export type ReactToMessage = {
  /** В какой ряд попадёт моя реакция, если поставить её сейчас. */
  audience: ReactionAudience;
  /**
   * Тап по реакции: та же, что стоит, — снять, другая — поставить вместо неё.
   * `audience` — ряд, если сообщение из другого чата: облачко островка
   * считается по участию в чате оригинала, а не этого.
   */
  toggle: (
    message: { id: string; reactions: MessageReactions },
    emoji: string,
    audience?: ReactionAudience,
  ) => void;
};

/**
 * Реакции на сообщения чата от моего имени. Ряд здесь — только догадка для
 * мгновенного отклика: куда реакция попадёт на самом деле, решит база.
 */
export function useReactToMessage(isMember: boolean): ReactToMessage {
  const queryClient = useQueryClient();
  const audience = audienceOf(isMember);

  const toggle = useCallback(
    (
      message: { id: string; reactions: MessageReactions },
      emoji: string,
      rowAudience: ReactionAudience = audience,
    ) => {
      sendReaction(queryClient, message.id, {
        emoji: nextReaction(message.reactions.mine, emoji),
        audience: rowAudience,
      });
    },
    [audience, queryClient],
  );

  return { audience, toggle };
}
