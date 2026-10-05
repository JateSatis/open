import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildCommentRows, buildThreadRows, type CommentRow } from './rows';

import { fetchComment } from '@/api/comments';
import {
  asDeletedRoot,
  toCommentItem,
  type CommentItem,
} from '@/features/interactions/comments/commentItem';
import {
  addToThread,
  pinRoot,
  rootsKey,
  updateRoots,
  updateThread,
} from '@/features/interactions/comments/commentsCache';
import {
  setOpenThread,
  useOpenThread,
  type CommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';
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
function useFocusComment(messageId: string, focusId: string | undefined) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState<string | null>(null);

  useEffect(() => {
    if (!focusId) return;

    let cancelled = false;

    void (async () => {
      try {
        const comment = toCommentItem(await fetchComment(focusId));
        const rootId = comment.threadRootId ?? comment.id;
        // Корень удалён — на его месте заглушка: тред жив, раз жив этот ответ.
        const root =
          rootId === comment.id
            ? comment
            : await fetchComment(rootId)
                .then(toCommentItem)
                .catch(() =>
                  asDeletedRoot({ ...comment, id: rootId, threadRootId: null, repliesCount: 1 }),
                );

        // Верх мог ещё грузиться — закрепить корень можно, только когда он лёг.
        await queryClient.fetchQuery({
          queryKey: rootsKey(messageId),
          queryFn: () => loadRoots(messageId),
          staleTime: Infinity,
        });

        if (cancelled) return;

        updateRoots(queryClient, messageId, (page) => pinRoot(page, root));

        if (comment.threadRootId) {
          updateThread(queryClient, messageId, rootId, (page) => addToThread(page, comment), {
            create: true,
          });
          setOpenThread(rootId, true);
        }

        setReady(focusId);
      } catch {
        if (!cancelled) showNotice('Комментарий удалён', 'error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusId, messageId, queryClient]);

  return ready;
}

/**
 * Всё, что панель рисует списками: верх по рангу — основной список, и окно
 * треда `threadRootId` — корень и его ответы.
 *
 * `threadRootId` — тред в окне, а не в сторе: уезжающее окно рисует свой
 * тред, хотя в сторе его уже нет.
 */
export function usePanelComments(
  target: CommentsPanelTarget,
  currentUserId: string | null,
  threadRootId: string | null,
) {
  const { messageId } = target;
  const { data: about } = useCommentTarget(messageId, target.chatId);
  const live = about?.state === 'live' ? about : null;
  const amMember = target.amMember ?? false;
  const comments = useComments(
    messageId,
    live?.message.chatId ?? target.chatId ?? '',
    currentUserId,
    amMember,
  );
  const openThread = useOpenThread();
  const thread = useCommentThread(messageId, threadRootId, comments.overlay);
  const focusReady = useFocusComment(messageId, target.focusCommentId);
  const { roots, pendingReplies } = comments;

  const pendingCount = useCallback(
    (rootId: string) => pendingReplies.get(rootId)?.length ?? 0,
    [pendingReplies],
  );

  const rows = useMemo<CommentRow[]>(
    () => buildCommentRows(roots, pendingCount),
    [pendingCount, roots],
  );

  const threadRows = useMemo<CommentRow[]>(
    () =>
      threadRootId
        ? buildThreadRows({
            root: roots.find((root) => root.id === threadRootId) ?? null,
            rootId: threadRootId,
            head: thread.head,
            tail: thread.tail,
            pending: pendingReplies.get(threadRootId) ?? NONE,
            hasGap: thread.hasGap,
            isLoading: thread.isLoading,
          })
        : [],
    [pendingReplies, roots, thread, threadRootId],
  );

  return {
    about,
    live,
    amMember,
    comments,
    openThread,
    thread,
    rows,
    threadRows,
    focusReady,
  };
}
