import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { MessageReactions, ReactionAudience } from '@/api/reactionCounts';
import { sendReaction } from '@/features/interactions/reactionSender';
import { audienceOf, nextReaction } from '@/features/interactions/reactionState';

export type ReactToMessage = {
  /** В какой ряд попадёт моя реакция, если поставить её сейчас. */
  audience: ReactionAudience;
  /** Тап по реакции: та же, что стоит, — снять, другая — поставить вместо неё. */
  toggle: (message: { id: string; reactions: MessageReactions }, emoji: string) => void;
};

/**
 * Реакции на сообщения чата от моего имени. Ряд здесь — только догадка для
 * мгновенного отклика: куда реакция попадёт на самом деле, решит база.
 */
export function useReactToMessage(chatId: string, isMember: boolean): ReactToMessage {
  const queryClient = useQueryClient();
  const audience = audienceOf(isMember);

  const toggle = useCallback(
    (message: { id: string; reactions: MessageReactions }, emoji: string) => {
      sendReaction(queryClient, chatId, message.id, {
        emoji: nextReaction(message.reactions.mine, emoji),
        audience,
      });
    },
    [audience, chatId, queryClient],
  );

  return { audience, toggle };
}
