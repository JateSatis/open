import type { ReactionIntent } from '@/features/interactions/reactionState';
import { mapOriginals } from '@/features/chats/islands/islandCache';
import type { ChatMessage } from '@/features/chats/messages/types';
import { withMyReaction } from '@/features/interactions/reactionState';

/**
 * Неподтверждённое поверх подтверждённого: сохраняющаяся правка — поверх
 * версии из истории, моя едущая реакция — поверх счётчиков, и у оригиналов в
 * островках, и у пересланного комментария. Реакции у правки — из истории:
 * пока правка едет, счётчики живут своей жизнью. Одно правило для переписки
 * и шторки треда.
 */
export function withPendingOverlays(
  items: ChatMessage[],
  pendingEdits: Record<string, ChatMessage>,
  pendingReactions: Record<string, ReactionIntent>,
): ChatMessage[] {
  if (Object.keys(pendingEdits).length === 0 && Object.keys(pendingReactions).length === 0) {
    return items;
  }

  return items.map((message) => {
    const pendingEdit = pendingEdits[message.id];
    const intent = pendingReactions[message.id];
    const base = pendingEdit
      ? { ...pendingEdit, reactions: message.reactions, commentsCount: message.commentsCount }
      : message;
    const own = intent ? { ...base, reactions: withMyReaction(base.reactions, intent) } : base;

    const withOriginals = mapOriginals(own, (original) => {
      const wanted = pendingReactions[original.id];

      return wanted
        ? { ...original, reactions: withMyReaction(original.reactions, wanted) }
        : original;
    });
    // Реакция на пересланный комментарий — его оригиналу, по id комментария.
    const forwarded = withOriginals.commentForward?.comment;
    const forComment = forwarded ? pendingReactions[forwarded.id] : undefined;

    return forwarded && forComment
      ? {
          ...withOriginals,
          commentForward: {
            ...withOriginals.commentForward!,
            comment: { ...forwarded, reactions: withMyReaction(forwarded.reactions, forComment) },
          },
        }
      : withOriginals;
  });
}
