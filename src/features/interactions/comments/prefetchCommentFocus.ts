import type { QueryClient } from '@tanstack/react-query';

import { commentFocusQueryKey, fetchComment, listCommentThreadWindow } from '@/api/comments';
import { loadRoots } from '@/features/interactions/comments/commentSync';
import { rootsKey } from '@/features/interactions/comments/commentsCache';

/** Starts all focus reads as soon as the navigation intent is known. */
export function prefetchCommentFocus(
  queryClient: QueryClient,
  targetId: string,
  commentId: string,
  rootId?: string,
) {
  void queryClient.prefetchQuery({
    queryKey: commentFocusQueryKey(commentId),
    queryFn: () => fetchComment(commentId),
    staleTime: 10_000,
  });

  void queryClient.prefetchQuery({
    queryKey: rootsKey(targetId),
    queryFn: () => loadRoots(targetId),
    staleTime: Infinity,
  });

  if (rootId) {
    void queryClient.prefetchQuery({
      queryKey: commentFocusQueryKey(rootId),
      queryFn: () => fetchComment(rootId),
      staleTime: 10_000,
    });
  }
}

export function commentFocusWindowQueryKey(targetId: string, rootId: string, commentId: string) {
  // Переоткрытие панели сбрасывает её обычные страницы, но короткий кеш
  // точного окна перехода остаётся доступен для повторного тапа по ссылке.
  return ['comment-focus-window', targetId, rootId, commentId] as const;
}

/** The forwarded row already supplies the stable time and thread ID. */
export function prefetchCommentThreadWindow(
  queryClient: QueryClient,
  targetId: string,
  rootId: string,
  focus: { id: string; createdAt: string },
) {
  void queryClient.prefetchQuery({
    queryKey: commentFocusWindowQueryKey(targetId, rootId, focus.id),
    queryFn: () => listCommentThreadWindow(rootId, focus),
    staleTime: 10_000,
  });
}
