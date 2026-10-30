import { useMemo } from 'react';

import type { SavedFilterInput } from '@/api/saved';
import { filterKey, hasFilters, toFilterInput, type SavedFilters } from '@/features/saved/savedFilters';
import { useSavedFilters } from '@/features/saved/savedFiltersStore';

export type SavedFilterState = {
  filters: SavedFilters;
  active: boolean;
  /** Параметры для базы; `null` — без фильтра. */
  input: SavedFilterInput | null;
  /** Ключ кеша списков; `null` — без фильтра. */
  key: string | null;
};

/** Текущий выбор фильтров и он же — параметрами для базы и ключом кеша. */
export function useSavedFilterInput(): SavedFilterState {
  const filters = useSavedFilters();

  return useMemo(() => {
    const input = toFilterInput(filters);

    return { filters, active: hasFilters(filters), input, key: filterKey(input) };
  }, [filters]);
}
