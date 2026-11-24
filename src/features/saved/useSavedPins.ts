import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQuery } from '@tanstack/react-query';

import { listSavedPins, type SavedFilterInput, type SavedPin } from '@/api/saved';
import { savedPinsKey } from '@/features/saved/keys';

const NO_PINS: SavedPin[] = [];

/**
 * Закрепы по времени закрепления: последний — в конце. Под фильтром —
 * только подходящие: полоса не ведёт к скрытой записи.
 */
export function useSavedPins({ input, key }: { input: SavedFilterInput | null; key: string | null }) {
  const api = useRequestClient();
  const query = useQuery({
    queryKey: savedPinsKey(key),
    queryFn: () => listSavedPins(input, api),
    refetchOnMount: 'always',
  });

  return query.data ?? NO_PINS;
}
