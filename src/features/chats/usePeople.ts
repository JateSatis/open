import { useQuery } from '@tanstack/react-query';

import { listPeople, type Person } from '@/api/chats';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import { describeLoadError } from '@/lib/network';

export const peopleQueryKey = ['people'] as const;

export type PeopleState = {
  people: Person[];
  isLoading: boolean;
  error: string | null;
};

/** Все остальные пользователи — временная замена поиску и контактам. */
export function usePeople(): PeopleState {
  const connection = useConnectionStatus();
  const { data, isPending, fetchStatus, error } = useQuery({
    queryKey: peopleQueryKey,
    queryFn: listPeople,
  });

  return {
    people: data ?? [],
    // Без связи запрос стоит на паузе. Показывать в этот момент крутилку —
    // значит врать, что данные вот-вот придут: они не придут, пока сети нет.
    isLoading: isPending && fetchStatus !== 'paused',
    error:
      data !== undefined || connection !== 'online'
        ? null
        : describeLoadError(error, 'Не удалось загрузить пользователей'),
  };
}
