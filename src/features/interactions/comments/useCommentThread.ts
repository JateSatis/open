import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listThreadReplies } from '@/api/comments';
import type { CommentItem } from '@/features/interactions/comments/commentItem';
import {
  appendThreadHead,
  readThread,
  threadKey,
  updateThread,
} from '@/features/interactions/comments/commentsCache';
import { loadThread } from '@/features/interactions/comments/commentSync';

const NONE: CommentItem[] = [];

export type CommentThreadState = {
  /** Начало треда — подряд, сверху первые. */
  head: CommentItem[];
  /** За разрывом: свои ответы и цель прыжка. */
  tail: CommentItem[];
  /** Между началом и хвостом есть незагруженные ответы. */
  hasGap: boolean;
  /** Начало ещё не читали. */
  isLoading: boolean;
  /** Начало прочитать не удалось — до повтора. */
  failed: boolean;
  /** Повторить чтение начала. */
  retry: () => void;
  isLoadingMore: boolean;
  /** Следующая порция начала; промис — когда она легла в кеш (или нечего грузить). */
  loadMore: () => Promise<void>;
};

/**
 * Открытый тред одного корня: первая порция ответов, «Показать ещё» и то,
 * что лежит за разрывом. `rootId: null` — тред закрыт, ничего не грузится.
 */
export function useCommentThread(
  messageId: string,
  rootId: string | null,
  overlay: (items: CommentItem[]) => CommentItem[],
): CommentThreadState {
  const queryClient = useQueryClient();
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const { data, refetch, isError, isFetching } = useQuery({
    queryKey: threadKey(messageId, rootId ?? ''),
    queryFn: () => loadThread(queryClient, messageId, rootId!),
    enabled: rootId !== null,
    // Сами по себе страницы треда не перечитываются: свежесть — сигналами канала.
    staleTime: Infinity,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  // В кеше может лежать только свой отправленный ответ: начало треда ещё не читали.
  const needsHead = rootId !== null && data !== undefined && !data.headLoaded;

  useEffect(() => {
    if (needsHead) void refetch();
  }, [needsHead, refetch]);

  const loadMore = useCallback(() => {
    if (!rootId) return Promise.resolve();

    const page = readThread(queryClient, messageId, rootId);

    if (!page?.headLoaded || page.nextCursor === null || loadingMoreRef.current) {
      return Promise.resolve();
    }

    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    return listThreadReplies(rootId, { cursor: page.nextCursor })
      .then((next) =>
        updateThread(queryClient, messageId, rootId, (current) =>
          appendThreadHead(current, next.items, next.nextCursor),
        ),
      )
      .catch(() => undefined)
      .finally(() => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  }, [messageId, queryClient, rootId]);

  const head = useMemo(() => overlay(data?.head ?? NONE), [data, overlay]);
  const tail = useMemo(() => overlay(data?.tail ?? NONE), [data, overlay]);

  return {
    head,
    tail,
    hasGap: Boolean(data && (!data.headLoaded || data.nextCursor !== null)),
    isLoading: rootId !== null && !data?.headLoaded,
    failed: rootId !== null && isError && !isFetching && !data?.headLoaded,
    retry: useCallback(() => void refetch(), [refetch]),
    isLoadingMore,
    loadMore,
  };
}
