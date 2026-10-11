import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import type { Pop } from '@/api/pops';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import {
  openPopComments,
  useCommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';

/**
 * Комментарии к попу из просмотра: какой поп сейчас с открытым шитом,
 * открытие по кнопке колонки и переход к профилю автора комментария.
 */
export function usePopComments(canPublish: boolean) {
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const subject = useCommentsPanelTarget()?.subject;
  const openPopId = subject?.type === 'pop' ? subject.id : null;

  const onOpenComments = useCallback(
    (pop: Pop) => openPopComments(pop.id, canPublish),
    [canPublish],
  );

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
