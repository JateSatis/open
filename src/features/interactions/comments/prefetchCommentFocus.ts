import type { QueryClient } from '@tanstack/react-query';

import { commentFocusQueryKey, fetchComment } from '@/api/comments';
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
