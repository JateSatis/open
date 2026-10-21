import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getLastSeen, type ActivityStatus } from '@/api/chatInfo';

/**
 * Как часто перечитывать статусы, пока экран открыт. Отметку «в сети»
 * приложение подтверждает раз в минуту и снимает при уходе в фон, так что
 * «в сети» появляется и пропадает с задержкой до полуминуты.
 */
export const ACTIVITY_POLL_MS = 30_000;

export function activityQueryKey(userIds: string[]) {
  return ['activity', userIds.join(',')] as const;
}

/**
 * Статусы людей с сервера: «в сети» и «был(а) в …» глазами смотрящего —
 * настройку каждого проверяет база. Пока ответа нет — `undefined`.
 */
export function usePeopleActivity(userIds: string[]): Map<string, ActivityStatus> | undefined {
  const ids = useMemo(() => [...new Set(userIds)].sort(), [userIds]);
  const { data } = useQuery({
    queryKey: activityQueryKey(ids),
    queryFn: () => getLastSeen(ids),
    enabled: ids.length > 0,
    refetchInterval: ACTIVITY_POLL_MS,
    staleTime: ACTIVITY_POLL_MS / 2,
  });

  return data;
}

/**
 * Кто из этих людей сейчас «в сети». Пусто, пока ответа нет, и для тех, кто
 * скрыл активность от меня, — «не в списке» значит «неизвестно или не в
 * сети», а не твёрдый факт.
 */
export function useOnlineUsers(userIds: string[]): Set<string> {
  const activity = usePeopleActivity(userIds);

  return useMemo(() => {
    const online = new Set<string>();

    activity?.forEach((status, id) => {
      if (status.online) online.add(id);
    });

    return online;
  }, [activity]);
}
