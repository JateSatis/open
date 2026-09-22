import { useQuery } from '@tanstack/react-query';

import { listDirectCandidates, type DirectCandidate } from '@/api/chats';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import { describeLoadError } from '@/lib/network';

export const directCandidatesQueryKey = ['direct-candidates'] as const;

export type DirectCandidatesState = {
  candidates: DirectCandidate[];
  isLoading: boolean;
  error: string | null;
};

/** Все остальные пользователи — временная замена поиску и контактам. */
export function useDirectCandidates(): DirectCandidatesState {
  const connection = useConnectionStatus();
  const { data, isPending, fetchStatus, error } = useQuery({
    queryKey: directCandidatesQueryKey,
    queryFn: listDirectCandidates,
  });

  return {
    candidates: data ?? [],
    // Без связи запрос стоит на паузе. Показывать в этот момент крутилку —
    // значит врать, что данные вот-вот придут: они не придут, пока сети нет.
    isLoading: isPending && fetchStatus !== 'paused',
    error:
      data !== undefined || connection !== 'online'
        ? null
        : describeLoadError(error, 'Не удалось загрузить пользователей'),
  };
}
