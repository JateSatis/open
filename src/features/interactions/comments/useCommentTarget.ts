import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { ChatSummary } from '@/api/chats';
import { getCommentTarget, type CommentTarget } from '@/api/comments';
import { originalAsMessage } from '@/features/chats/islands/rows';
import { findOriginals } from '@/features/chats/islands/islandCache';
import { readAllHistories, readHistory } from '@/features/chats/messages/historyCache';
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
  // Оригинал, открытый из островка, лежит в кеше не своего чата, а в островке.
  const inIsland = readAllHistories(queryClient)
    .flatMap((history) => findOriginals(history.items, new Set([messageId])))
    .at(0);

  if (inIsland) {
    return {
      state: 'live',
      message: originalAsMessage(inIsland),
      authorName: inIsland.authorName,
      authorAvatarUrl: inIsland.authorAvatarUrl,
    };
  }

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
