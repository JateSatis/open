import { useRouter } from '@/navigation';
import { useCallback, useEffect } from 'react';

import type { Pop } from '@/api/pops';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import {
  openPopComments,
  setCommentsAmMember,
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

  // Шит открыли раньше, чем пришло право публиковать, — догоняем его.
  useEffect(() => {
    if (openPopId) setCommentsAmMember(canPublish);
  }, [canPublish, openPopId]);

  // Просмотр — экран поверх вкладок, профиль — во вкладке чатов под ним.
  const onOpenPerson = useCallback(
    (personId: string) => {
      router.back();

      if (personId === currentUserId) router.navigate({ name: 'Tabs', params: { screen: 'profile' } });
      else router.push({ name: 'Person', params: { userId: personId } });
    },
    [currentUserId, router],
  );

  return { openPopId, onOpenComments, onOpenPerson };
}
