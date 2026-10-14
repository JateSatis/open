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
  raiseRoot,
  rootsKey,
  updateRoots,
  updateThread,
} from '@/features/interactions/comments/commentsCache';
import {
  setOpenThread,
  useOpenThread,
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
          queryKey: rootsKey(targetId),
          queryFn: () => loadRoots(targetId),
          staleTime: Infinity,
        });

        if (cancelled) return;

        updateRoots(queryClient, targetId, (page) => raiseRoot(page, root));

        if (comment.threadRootId) {
          updateThread(queryClient, targetId, rootId, (page) => addToThread(page, comment), {
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
  }, [focusId, targetId, queryClient]);

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
  const { subject } = target;
  const targetId = subject.id;
  const { data: about } = useCommentTarget(subject, target.chatId);
  const live = about?.state === 'live' ? about : null;
  const pop = about?.state === 'pop' ? about.pop : null;
  const amMember = target.amMember ?? false;
  const { fragment } = target;
  // Панель фрагмента: свой фрагмент база находит по диапазону — и новый
  // создаёт первым комментарием. Объект один на открытие панели: от него
  // зависят отправки.
  const fragmentScope = useMemo<FragmentScope | undefined>(
    () =>
      fragment
        ? { key: fragment.key, fragmentId: fragment.fragmentId, request: fragment.range }
        : undefined,
    [fragment],
  );
  const comments = useComments(
    subject,
    live?.message.chatId ?? pop?.postsChatId ?? target.chatId ?? '',
    currentUserId,
    amMember,
    fragmentScope,
  );
  const openThread = useOpenThread();
  const thread = useCommentThread(targetId, threadRootId, comments.overlay);
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
            failed: thread.failed,
          })
        : [],
    [pendingReplies, roots, thread, threadRootId],
  );

  return {
    about,
    live,
    pop,
    amMember,
    comments,
    openThread,
    thread,
    rows,
    threadRows,
    focusReady,
  };
}
