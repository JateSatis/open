import { useCallback, useEffect, useRef } from 'react';

import type { SavedMessage } from '@/api/saved';
import { showNotice } from '@/features/notifications/alertsStore';
import {
  addFilterTag,
  getSavedFilters,
  resetSavedFilters,
} from '@/features/saved/savedFiltersStore';

type Pending = { id: string; seq: number; fromKey: string | null };

/**
 * Переходы, которые меняют фильтры: тап по тегу на пузыре (запись остаётся
 * на виду в отфильтрованном списке) и «Сбросить» у цитаты на запись, скрытую
 * фильтрами. Список под новым фильтром грузится заново — прыжок к записи
 * ждёт, пока он придёт.
 */
export function useFilterJumps({
  filterKey,
  filtered,
  loading,
  jump,
}: {
  filterKey: string | null;
  filtered: boolean;
  loading: boolean;
  jump: (id: string, seq: number) => Promise<boolean>;
}) {
  const pendingRef = useRef<Pending | null>(null);

  useEffect(() => {
    const pending = pendingRef.current;

    if (!pending || pending.fromKey === filterKey || loading) return;

    pendingRef.current = null;
    void jump(pending.id, pending.seq);
  }, [filterKey, jump, loading]);

  const filterByTag = useCallback(
    (tagId: string, saved: SavedMessage) => {
      // Уже выбран — ничего не меняется.
      if (getSavedFilters().tags.includes(tagId)) return;

      pendingRef.current = { id: saved.id, seq: saved.seq, fromKey: filterKey };
      addFilterTag(tagId);
    },
    [filterKey],
  );

  const openQuote = useCallback(
    (id: string, seq: number) => {
      void jump(id, seq).then((found) => {
        if (found || !filtered) return;

        showNotice('Запись скрыта фильтрами', 'info', {
          label: 'Сбросить',
          run: () => {
            pendingRef.current = { id, seq, fromKey: filterKey };
            resetSavedFilters();
          },
        });
      });
    },
    [filterKey, filtered, jump],
  );

  return { filterByTag, openQuote };
}
