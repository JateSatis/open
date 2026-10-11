import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { ChatSummary } from '@/api/chats';
import {
  getCommentTarget,
  getPopCommentTarget,
  type CommentSubject,
  type CommentTarget,
} from '@/api/comments';
import { originalAsMessage } from '@/features/chats/islands/rows';
import { findOriginals } from '@/features/chats/islands/islandCache';
import { readAllHistories, readHistory } from '@/features/chats/messages/historyCache';
import type { Channel } from '@/api/channels';
import { channelQueryKey } from '@/features/channels/keys';
import { chatQueryKey } from '@/features/chats/useChat';
import { findCachedPop } from '@/features/pops/popsCache';

export function commentTargetQueryKey(targetId: string) {
  return ['comment-target', targetId] as const;
}

/**
 * Облачко из переписки, которая уже на экране: панель показывает его в первом
 * же кадре, а свежую версию с сервера подтягивает следом.
 */
function fromChatCache(
  queryClient: ReturnType<typeof useQueryClient>,
  targetId: string,
  chatId: string | undefined,
): CommentTarget | undefined {
  // Оригинал, открытый из островка, лежит в кеше не своего чата, а в островке.
  const inIsland = readAllHistories(queryClient)
    .flatMap((history) => findOriginals(history.items, new Set([targetId])))
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

  const message = readHistory(queryClient, chatId)?.items.find((item) => item.id === targetId);

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

/**
 * Поп из просмотра, который уже на экране, и его канал: число в шапке и чат
 * постов — с первого кадра, свежая версия следом.
 */
function fromPopCache(
  queryClient: ReturnType<typeof useQueryClient>,
  popId: string,
): CommentTarget | undefined {
  const pop = findCachedPop(queryClient, popId);
  const channel = pop ? queryClient.getQueryData<Channel>(channelQueryKey(pop.channelId)) : undefined;

  if (!pop || !channel) return undefined;

  return {
    state: 'pop',
    pop: {
      id: pop.id,
      channelId: pop.channelId,
      channelTitle: channel.title,
      postsChatId: channel.postsChatId,
      commentsCount: pop.commentsCount,
    },
  };
}

/** Сообщение или поп, к которому открыты комментарии: живое, удалённое или не найденное. */
export function useCommentTarget(subject: CommentSubject, chatId?: string) {
  const queryClient = useQueryClient();
  const { type, id } = subject;

  return useQuery({
    queryKey: commentTargetQueryKey(id),
    queryFn: () => (type === 'pop' ? getPopCommentTarget(id) : getCommentTarget(id)),
    placeholderData: () =>
      type === 'message' ? fromChatCache(queryClient, id, chatId) : fromPopCache(queryClient, id),
  });
}
