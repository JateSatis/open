import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQuery } from '@tanstack/react-query';

import { getSavedSummary } from '@/api/saved';
import { savedSummaryQueryKey } from '@/features/saved/keys';

/** Невыполненные «Посмотреть позже» — для строки в «Чатах». */
export function useSavedSummary(): number {
  const api = useRequestClient();
  const query = useQuery({ queryKey: savedSummaryQueryKey, queryFn: () => getSavedSummary(api) });

  return query.data?.watchLaterPending ?? 0;
}
