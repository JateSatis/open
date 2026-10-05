import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Глубже стольких порций за комментарием не идём: дальше дешевле сказать «не найден». */
const MAX_PAGES = 20;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

type Source = {
  /** Ключи строк списка по порядку. */
  keys: string[];
  /** Есть ещё что догрузить там, где может лежать комментарий. */
  hasMore: boolean;
  loadMore: () => Promise<void>;
};

/**
 * Прыжок к комментарию: если его строки ещё нет — догружаем (открытый тред
 * или следующую страницу верха), пока не найдём, потом прокручиваем к нему и
 * подсвечиваем, как прыжок к сообщению в переписке.
 */
export function useJumpToComment<T>(listRef: RefObject<FlashListRef<T> | null>, source: Source) {
  const [highlight, setHighlight] = useState<{ id: string; key: number } | null>(null);
  const latest = useRef(source);

  useEffect(() => {
    latest.current = source;
  }, [source]);

  const jump = useCallback(
    async (commentId: string, { flash = true }: { flash?: boolean } = {}): Promise<boolean> => {
      for (let page = 0; page <= MAX_PAGES; page += 1) {
        const index = latest.current.keys.indexOf(commentId);

        if (index !== -1) {
          listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
          if (flash) setHighlight({ id: commentId, key: Date.now() });
          return true;
        }

        if (!latest.current.hasMore) break;

        await latest.current.loadMore();
        // Догруженное попадает в список после перерисовки.
        await nextFrame();
        await nextFrame();
      }

      return false;
    },
    [listRef],
  );

  return { jump, highlight };
}
