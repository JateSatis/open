import { useCallback, useMemo } from 'react';

import { buildCommentRows, buildCommentThreadRows, type CommentRow } from './rows';

import { trackClusterEvent } from '@/api/fragmentClusterEvents';
import type { CommentItem } from '@/features/interactions/comments/commentItem';
import {
  fragmentSetOf,
  useOpenCommentThread,
  type CommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';
import type { FragmentScope } from '@/features/interactions/comments/commentDelivery';
import { useComments } from '@/features/interactions/comments/useComments';
import { useCommentTarget } from '@/features/interactions/comments/useCommentTarget';
import { useCommentThread } from '@/features/interactions/comments/useCommentThread';

const NONE: CommentItem[] = [];

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
  const commentThread = useCommentThread(
    targetId,
    commentThreadRootId,
    comments.overlay,
  );
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
  };
}
