import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildCommentRows, buildCommentThreadRows, type CommentRow } from './rows';

import { fetchComment } from '@/api/comments';
import { trackClusterEvent } from '@/api/fragmentClusterEvents';
import {
  asDeletedRoot,
  toCommentItem,
  type CommentItem,
} from '@/features/interactions/comments/commentItem';
import {
  addToCommentThread,
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
import { showNotice } from '@/features/notifications/alertsStore';

const NONE: CommentItem[] = [];

/**
 * Комментарий, к которому пришли (тап по пересланному): он и его корень
 * встают наверх, у ответа сразу, без въезда, открыто окно его треда. Отдаёт
 * id, к которому прыгнуть, когда он окажется в списке.
 */
function useFocusComment(targetId: string, focusId: string | undefined) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState<string | null>(null);

  useEffect(() => {
    if (!focusId) return;

    let cancelled = false;

    void (async () => {
      try {
        const comment = toCommentItem(await fetchComment(focusId));
        const rootId = comment.commentThreadRootId ?? comment.id;
        // Корень удалён — на его месте заглушка: тред жив, раз жив этот ответ.
        const root =
          rootId === comment.id
            ? comment
            : await fetchComment(rootId)
                .then(toCommentItem)
                .catch(() =>
                  asDeletedRoot({
                    ...comment,
                    id: rootId,
                    commentThreadRootId: null,
                    repliesCount: 1,
                  }),
                );

        // Верх мог ещё грузиться — закрепить корень можно, только когда он лёг.
        await queryClient.fetchQuery({
          queryKey: rootsKey(targetId),
          queryFn: () => loadRoots(targetId),
          staleTime: Infinity,
        });

        if (cancelled) return;

        updateRoots(queryClient, targetId, (page) => raiseRoot(page, root));

        if (comment.commentThreadRootId) {
          updateCommentThread(
            queryClient,
            targetId,
            rootId,
            (page) => addToCommentThread(page, comment),
            {
              create: true,
            },
          );
          setOpenCommentThread(rootId, true);
        }

        setReady(focusId);
      } catch {
        if (!cancelled) showNotice('Комментарий удалён', 'error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusId, targetId, queryClient]);

  return ready;
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
  const commentThread = useCommentThread(targetId, commentThreadRootId, comments.overlay);
  const focusReady = useFocusComment(targetId, target.focusCommentId);
  const { roots, pendingReplies, pinnedId } = comments;

  const pendingCount = useCallback(
    (rootId: string) => pendingReplies.get(rootId)?.length ?? 0,
    [pendingReplies],
  );

  const rows = useMemo<CommentRow[]>(
    () => buildCommentRows(roots, pendingCount, pinnedId),
    [pendingCount, pinnedId, roots],
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
    focusReady,
  };
}
