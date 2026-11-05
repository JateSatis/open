import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import type { Pop } from '@/api/pops';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import {
  openPopComments,
  setCommentsAmMember,
  useCommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';

/** Просмотр открыт сразу с комментариями к стартовому попу — по пересланному комментарию. */
export type StartWithComments = {
  startId: string;
  focusCommentId?: string;
  focusRootId?: string;
  requestId?: string;
  /** Стартовый поп стал активной страницей и экран готов — пора открывать шит. */
  ready: boolean;
};

/**
 * Комментарии к попу из просмотра: какой поп сейчас с открытым шитом,
 * открытие по кнопке колонки и переход к профилю автора комментария.
 */
export function usePopComments(canPublish: boolean, start?: StartWithComments) {
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const subject = useCommentsPanelTarget()?.subject;
  const openPopId = subject?.type === 'pop' ? subject.id : null;

  const onOpenComments = useCallback(
    (pop: Pop) => openPopComments(pop.id, canPublish),
    [canPublish],
  );

  // Шит открыли раньше, чем пришло право публиковать, — догоняем его.
  useEffect(() => {
    if (openPopId) setCommentsAmMember(canPublish);
  }, [canPublish, openPopId]);

  // Шит открывается один раз: закрыл — листает попсы дальше без него.
  const startedRef = useRef<string | null>(null);
  const startKey = start
    ? `${start.startId}:${start.requestId ?? start.focusCommentId ?? 'comments'}`
    : null;

  useEffect(() => {
    if (!start || !start.ready || startKey === null || startedRef.current === startKey) return;

    startedRef.current = startKey;
    openPopComments(
      start.startId,
      canPublish,
      start.focusCommentId,
      start.focusRootId,
      start.requestId,
    );
  }, [canPublish, start, startKey]);

  // Просмотр — экран поверх вкладок, профиль — во вкладке чатов под ним.
  const onOpenPerson = useCallback(
    (personId: string) => {
      router.back();

      if (personId === currentUserId) router.navigate('/profile');
      else router.push(`/chats/people/${personId}`);
    },
    [currentUserId, router],
  );

  return { openPopId, onOpenComments, onOpenPerson };
}
