import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { ChatSummary } from '@/api/chats';
import { getCommentTarget, type CommentTarget } from '@/api/comments';
import { readHistory } from '@/features/chats/messages/historyCache';
import { chatQueryKey } from '@/features/chats/useChat';

export function commentTargetQueryKey(messageId: string) {
  return ['comment-target', messageId] as const;
}

/**
 * Облачко из переписки, которая уже на экране: панель показывает его в первом
 * же кадре, а свежую версию с сервера подтягивает следом.
 */
function fromChatCache(
  queryClient: ReturnType<typeof useQueryClient>,
  messageId: string,
  chatId: string | undefined,
): CommentTarget | undefined {
  if (!chatId) return undefined;

  const message = readHistory(queryClient, chatId)?.items.find((item) => item.id === messageId);

  if (!message) return undefined;

  const author = queryClient
    .getQueryData<ChatSummary>(chatQueryKey(chatId))
    ?.participants.find((person) => person.id === message.authorId);

  return {
    state: 'live',
    message,
    authorName: author?.displayName ?? null,
    authorAvatarUrl: author?.avatarUrl ?? null,
  };
}

/** Сообщение, к которому открыты комментарии: живое, удалённое или не найденное. */
export function useCommentTarget(messageId: string, chatId?: string) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: commentTargetQueryKey(messageId),
    queryFn: () => getCommentTarget(messageId),
    placeholderData: () => fromChatCache(queryClient, messageId, chatId),
  });
}
