import { useQuery } from '@tanstack/react-query';

import { listDirectCandidates, type DirectCandidate } from '@/api/chats';
import { describeLoadError } from '@/lib/network';

export const directCandidatesQueryKey = ['direct-candidates'] as const;

export type DirectCandidatesState = {
  candidates: DirectCandidate[];
  isLoading: boolean;
  error: string | null;
};

/** Все остальные пользователи — временная замена поиску и контактам. */
export function useDirectCandidates(): DirectCandidatesState {
  const { data, isPending, error } = useQuery({
    queryKey: directCandidatesQueryKey,
    queryFn: listDirectCandidates,
  });

  return {
    candidates: data ?? [],
    isLoading: isPending,
    error: describeLoadError(error, 'Не удалось загрузить пользователей'),
  };
}
