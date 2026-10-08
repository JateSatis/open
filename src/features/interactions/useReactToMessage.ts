import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { MessageReactions, ReactionAudience } from '@/api/reactionCounts';
import { sendReaction } from '@/features/interactions/reactionSender';
import { audienceOf, nextReaction, type Me } from '@/features/interactions/reactionState';

export type ReactToMessage = {
  /** Я как поставивший — тот же для реакций на пересланные комментарии. */
  me?: Me;
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
 * `me` — я как поставивший: оптимистичная реакция сразу с моим аватаром.
 */
export function useReactToMessage(isMember: boolean, me?: Me): ReactToMessage {
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
        me,
      });
    },
    [audience, me, queryClient],
  );

  return { audience, me, toggle };
}
