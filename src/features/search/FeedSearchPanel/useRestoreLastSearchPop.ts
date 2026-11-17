import type { FlashListRef, ViewToken } from '@shopify/flash-list';
import { useFocusEffect } from '@/navigation';
import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { rowOfPop, type FeedSearchRow } from '@/features/search/feedSearchRows';
import { useLastSearchPop } from '@/features/search/lastSearchPop';

/**
 * Вернулись из просмотра выдачи: последний просмотренный поп ушёл с экрана —
 * сетка встаёт так, чтобы он был виден. Виден и так — прокрутка не трогается.
 * Отдаёт обработчик видимых строк для списка.
 */
export function useRestoreLastSearchPop(
  listRef: RefObject<FlashListRef<FeedSearchRow> | null>,
  rows: FeedSearchRow[],
) {
  const rowsRef = useRef(rows);
  const visibleKeys = useRef(new Set<string>());

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useFocusEffect(
    useCallback(() => {
      const last = useLastSearchPop.getState().id;

      if (!last) return;

      useLastSearchPop.setState({ id: null });

      const index = rowOfPop(rowsRef.current, last);
      const row = rowsRef.current[index];

      if (index < 0 || !row || visibleKeys.current.has(row.key)) return;

      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
    }, [listRef]),
  );

  return useCallback(({ viewableItems }: { viewableItems: ViewToken<FeedSearchRow>[] }) => {
    visibleKeys.current = new Set(
      viewableItems.filter((token) => token.isViewable).map((token) => token.item.key),
    );
  }, []);
}
