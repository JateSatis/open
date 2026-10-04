import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildCommentRows, type CommentRow } from './rows';

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
 * встают наверх, тред раскрыт. Отдаёт id, к которому прыгнуть, когда он
 * окажется в списке.
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
          setOpenThread(rootId);
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
 * Всё, что панель рисует списком: сообщение сверху, верх по рангу, раскрытый
 * тред и строки из них.
 */
export function usePanelComments(target: CommentsPanelTarget, currentUserId: string | null) {
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
  const thread = useCommentThread(messageId, openThread, comments.overlay);
  const focusReady = useFocusComment(messageId, target.focusCommentId);
  const { roots, pendingReplies } = comments;

  const pendingCount = useCallback(
    (rootId: string) => pendingReplies.get(rootId)?.length ?? 0,
    [pendingReplies],
  );

  const rows = useMemo<CommentRow[]>(
    () =>
      buildCommentRows(
        roots,
        openThread
          ? {
              rootId: openThread,
              head: thread.head,
              tail: thread.tail,
              pending: pendingReplies.get(openThread) ?? NONE,
              hasGap: thread.hasGap,
              isLoading: thread.isLoading,
            }
          : null,
        pendingCount,
      ),
    [openThread, pendingCount, pendingReplies, roots, thread],
  );

  /** Комментарии на экране — по порядку строк. */
  const visible = useMemo(
    () => rows.flatMap((row) => (row.type === 'comment' && !row.comment.deleted ? [row.comment] : [])),
    [rows],
  );

  return { about, live, amMember, comments, openThread, thread, rows, visible, focusReady };
}
