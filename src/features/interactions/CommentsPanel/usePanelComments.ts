import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildCommentRows, buildCommentThreadRows, type CommentRow } from './rows';

import {
  fetchComment,
  commentFocusQueryKey,
  listCommentRootsAround,
  listCommentThreadWindow,
} from '@/api/comments';
import { trackClusterEvent } from '@/api/fragmentClusterEvents';
import {
  asDeletedRoot,
  toCommentItem,
  type CommentItem,
} from '@/features/interactions/comments/commentItem';
import {
  focusedCommentThread,
  raiseRoot,
  rootsKey,
  updateRoots,
  updateCommentThread,
} from '@/features/interactions/comments/commentsCache';
import {
  fragmentSetOf,
  setOpenCommentThread,
  useOpenCommentThread,
  type CommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';
import type { FragmentScope } from '@/features/interactions/comments/commentDelivery';
import { loadRoots } from '@/features/interactions/comments/commentSync';
import { useComments } from '@/features/interactions/comments/useComments';
import { useCommentTarget } from '@/features/interactions/comments/useCommentTarget';
import { useCommentThread } from '@/features/interactions/comments/useCommentThread';
import { commentFocusWindowQueryKey } from '@/features/interactions/comments/prefetchCommentFocus';
import { showNotice } from '@/features/notifications/alertsStore';
import { navigationPerfMark, navigationPerfStart } from '@/features/media/perf';

const NONE: CommentItem[] = [];

/**
 * Комментарий, к которому пришли (тап по пересланному): он и его корень
 * встают наверх, у ответа сразу, без въезда, открыто окно его треда. Отдаёт
 * id, к которому прыгнуть, когда он окажется в списке.
 */
function useFocusComment(
  targetId: string,
  focusId: string | undefined,
  focusKey: string | undefined,
  focusRootHint: string | undefined,
) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<
    { id: string; key: string; failed: boolean } | null
  >(null);

  useEffect(() => {
    if (!focusId || !focusKey) return;

    let cancelled = false;
    const attemptId = `comment-${focusKey}`;
    navigationPerfStart(attemptId, 'comment', { targetId, focusId, focusRootHint });

    void (async () => {
      try {
        // Цель и верхний список независимы: не ждём один запрос перед вторым.
        const focusRequest = queryClient.fetchQuery({
            queryKey: commentFocusQueryKey(focusId),
            queryFn: () => fetchComment(focusId),
            staleTime: 10_000,
          });
        void focusRequest.then(
          () => navigationPerfMark(attemptId, 'focus-response-ready'),
          () => undefined,
        );
        // Корни основного списка не нужны, чтобы открыть найденный ответ.
        // Запускаем их сейчас для фона, но не ставим перед целевым тредом.
        const rootsRequest = queryClient.fetchQuery({
            queryKey: rootsKey(targetId),
            queryFn: () => loadRoots(targetId),
            staleTime: Infinity,
          });
        void rootsRequest.catch(() => undefined);
        const hintedRootRequest = focusRootHint
          ? queryClient
              .fetchQuery({
                queryKey: commentFocusQueryKey(focusRootHint),
                queryFn: () => fetchComment(focusRootHint),
                staleTime: 10_000,
              })
              .catch(() => null)
          : Promise.resolve(null);

        const fresh = await focusRequest;
        navigationPerfMark(attemptId, 'focus-dependencies-ready');

        const rootId = fresh.commentThreadRootId ?? fresh.id;

        if (cancelled) return;

        if (fresh.commentThreadRootId) {
          // Корень и окно — независимые чтения. Запускаем оба сразу после
          // получения цели; загрузка первой страницы списка корней идёт в фоне.
          const rootRequest = hintedRootRequest.then((hintedRoot) =>
            hintedRoot?.id === rootId
              ? hintedRoot
              : queryClient.fetchQuery({
                  queryKey: commentFocusQueryKey(rootId),
                  queryFn: () => fetchComment(rootId),
                  staleTime: 10_000,
                }),
          );
          const windowRequest = queryClient.fetchQuery({
            queryKey: commentFocusWindowQueryKey(targetId, rootId, fresh.id),
            queryFn: () => listCommentThreadWindow(rootId, fresh),
            staleTime: 10_000,
          });
          void rootRequest.then(
            () => navigationPerfMark(attemptId, 'root-response-ready'),
            () => navigationPerfMark(attemptId, 'root-response-failed'),
          );
          void windowRequest.then(
            () => navigationPerfMark(attemptId, 'window-response-ready'),
            () => navigationPerfMark(attemptId, 'window-response-failed'),
          );
          const [root, window] = await Promise.all([
            rootRequest
              .then(toCommentItem)
              .catch(() =>
                asDeletedRoot({
                  ...toCommentItem({
                    ...fresh,
                    id: rootId,
                    commentThreadRootId: null,
                    repliesCount: Math.max(1, fresh.repliesCount),
                  }),
                }),
              ),
            windowRequest,
            rootsRequest,
          ]);

          if (cancelled) return;

          updateRoots(queryClient, targetId, (page) => raiseRoot(page, root));
          updateCommentThread(
            queryClient,
            targetId,
            rootId,
            (current) =>
              focusedCommentThread(
                window.before,
                fresh,
                window.after,
                window.beforeCursor,
                window.afterCursor,
                current,
              ),
            { create: true },
          );
          setOpenCommentThread(rootId, true);
        } else {
          setOpenCommentThread(null);
          const [around] = await Promise.all([
            listCommentRootsAround(targetId, fresh),
            rootsRequest,
          ]);

          if (cancelled) return;

          // Window neighbours are promoted only for this panel session; their
          // rank is unchanged and they are removed from pages when encountered.
          const ordered = [
            ...around.filter((item) => item.rank > fresh.rank || (item.rank === fresh.rank && item.id > fresh.id)),
            fresh,
            ...around.filter((item) => item.rank < fresh.rank || (item.rank === fresh.rank && item.id < fresh.id)),
          ];
          updateRoots(queryClient, targetId, (page) =>
            ordered.slice().reverse().reduce((current, item) => raiseRoot(current, toCommentItem(item)), page),
          );
        }

        setResult({ id: focusId, key: focusKey, failed: false });
        navigationPerfMark(attemptId, 'target-composition-ready');
        navigationPerfMark(attemptId, 'environment-ready');
      } catch {
        if (!cancelled) {
          setOpenCommentThread(null);
          setResult({ id: focusId, key: focusKey, failed: true });
          showNotice('Комментарий удалён или недоступен', 'error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusId, focusKey, focusRootHint, targetId, queryClient]);

  return {
    ready: result && result.key === focusKey && !result.failed ? result : null,
    pending: Boolean(focusId && focusKey && (!result || result.key !== focusKey)),
  };
}

/**
 * Всё, что панель рисует списками: верх по рангу — основной список, и окно
 * треда `commentThreadRootId` — корень и его ответы.
 *
 * `commentThreadRootId` — тред в окне, а не в сторе: уезжающее окно рисует свой
 * тред, хотя в сторе его уже нет.
 */
export function usePanelComments(
  target: CommentsPanelTarget,
  currentUserId: string | null,
  commentThreadRootId: string | null,
) {
  const { subject } = target;
  const targetId = subject.id;
  const { data: about } = useCommentTarget(subject, target.chatId);
  const live = about?.state === 'live' ? about : null;
  const pop = about?.state === 'pop' ? about.pop : null;
  const amMember = target.amMember ?? false;
  const { fragment } = target;
  // Боковая панель: мой комментарий уходит к моему фрагменту её куска —
  // база находит его по диапазону и создаёт, если его нет. Объект один на
  // открытие панели: от него зависят отправки.
  const fragmentScope = useMemo<FragmentScope | undefined>(
    () =>
      fragment
        ? {
            key: fragment.key,
            set: fragmentSetOf(fragment),
            request: fragment.range,
            onSent: () =>
              trackClusterEvent({
                kind: 'cluster_commented',
                messageId: targetId,
                decisionId: fragment.kind === 'cluster' ? fragment.decisionId : null,
                clusterId: fragment.kind === 'cluster' ? fragment.clusterId : null,
                rangeStart: fragment.range.start,
                rangeEnd: fragment.range.end,
                detail: fragment.kind === 'area' ? { area: 1 } : {},
              }),
          }
        : undefined,
    [fragment, targetId],
  );
  const comments = useComments(
    subject,
    live?.message.chatId ?? pop?.postsChatId ?? target.chatId ?? '',
    currentUserId,
    amMember,
    fragmentScope,
  );
  const openCommentThread = useOpenCommentThread();
  const focus = useFocusComment(
    targetId,
    target.focusCommentId,
    target.focusKey,
    target.focusRootId,
  );
  const commentThread = useCommentThread(
    targetId,
    commentThreadRootId,
    comments.overlay,
    focus.pending,
  );
  const { roots, pendingReplies, pinnedId } = comments;

  const pendingCount = useCallback(
    (rootId: string) => pendingReplies.get(rootId)?.length ?? 0,
    [pendingReplies],
  );

  const rows = useMemo<CommentRow[]>(
    () => (focus.pending ? [] : buildCommentRows(roots, pendingCount, pinnedId)),
    [focus.pending, pendingCount, pinnedId, roots],
  );

  const commentThreadRows = useMemo<CommentRow[]>(
    () =>
      commentThreadRootId
        ? buildCommentThreadRows({
            root: roots.find((root) => root.id === commentThreadRootId) ?? null,
            rootId: commentThreadRootId,
            head: commentThread.head,
            tail: commentThread.tail,
            pending: pendingReplies.get(commentThreadRootId) ?? NONE,
            hasGap: commentThread.hasGap,
            hasBefore: commentThread.hasBefore,
            isLoading: commentThread.isLoading,
            failed: commentThread.failed,
          })
        : [],
    [pendingReplies, roots, commentThread, commentThreadRootId],
  );

  return {
    about,
    live,
    pop,
    amMember,
    comments,
    openCommentThread,
    commentThread,
    rows,
    commentThreadRows,
    focusReady: focus.ready,
    focusPending: focus.pending,
  };
}
