import { useQuery } from '@tanstack/react-query';

import { listSavedPins, type SavedPin } from '@/api/saved';
import { savedPinsQueryKey } from '@/features/saved/keys';

const NO_PINS: SavedPin[] = [];

/** Закрепы «Сохранённых» по времени закрепления: последний — в конце. */
export function useSavedPins(): SavedPin[] {
  const query = useQuery({
    queryKey: savedPinsQueryKey,
    queryFn: listSavedPins,
    refetchOnMount: 'always',
  });

  return query.data ?? NO_PINS;
}
