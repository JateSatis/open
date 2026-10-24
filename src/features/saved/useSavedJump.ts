import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList } from 'react-native';

import type { SavedMessage } from '@/api/saved';

/** Сколько ждать, пока список дорисует строки вокруг примерной позиции. */
const RETRY_SCROLL_MS = 120;

type ScrollFailure = { index: number; averageItemLength: number };

/**
 * Переход к записи на «Все» (к закрепу): нет её среди загруженного — список
 * становится окном вокруг неё (`loadAround`), а не догружает всю историю.
 * Прокрутка — когда строка уже в списке; подсветка — как у прыжка в чате.
 */
export function useSavedJump(
  listRef: RefObject<FlatList<SavedMessage> | null>,
  items: readonly SavedMessage[],
  loadAround: (seq: number) => Promise<boolean>,
) {
  const [highlight, setHighlight] = useState<{ id: string; key: number } | null>(null);
  const [jumps, setJumps] = useState(0);
  const targetRef = useRef<string | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const target = targetRef.current;

    if (!target) return;

    const index = items.findIndex((saved) => saved.id === target);

    if (index === -1) return;

    targetRef.current = null;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }, [items, jumps, listRef]);

  useEffect(
    () => () => {
      if (retryRef.current) clearTimeout(retryRef.current);
    },
    [],
  );

  const jump = useCallback(
    async (id: string, seq: number) => {
      const found = await loadAround(seq);

      if (!found) return false;

      targetRef.current = id;
      setJumps((count) => count + 1);
      setHighlight({ id, key: Date.now() });
      return true;
    },
    [loadAround],
  );

  const onScrollToIndexFailed = useCallback(
    ({ index, averageItemLength }: ScrollFailure) => {
      listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });

      if (retryRef.current) clearTimeout(retryRef.current);

      retryRef.current = setTimeout(() => {
        listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      }, RETRY_SCROLL_MS);
    },
    [listRef],
  );

  return { jump, highlight, onScrollToIndexFailed };
}
