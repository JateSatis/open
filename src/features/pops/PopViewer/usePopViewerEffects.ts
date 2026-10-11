import { useCallback, useEffect } from 'react';

import { recordPopViews, type Pop } from '@/api/pops';
import type { usePopFeed } from '@/features/pops/usePopFeed';
import { useViewBatcher } from '@/lib/useViewBatcher';

/** Ближе этого к краю загруженного — подгружаем следующую страницу. */
const PREFETCH_PAGES = 3;

/**
 * Просмотр — сразу при показе: поп стал активной страницей. Ушёл и вернулся —
 * новый показ (сервер засчитает не чаще раза в 10 секунд). Свои не
 * отправляются: публикующим в канале база их всё равно не засчитает.
 */
export function usePopViewCounting(
  pops: Pop[],
  activeIndex: number,
  canPublish: boolean,
  focused: boolean,
) {
  const send = useCallback(
    (items: { id: string }[], sessionId: string) =>
      recordPopViews(
        items.map(({ id }) => id),
        sessionId,
      ),
    [],
  );
  const { setVisible } = useViewBatcher({ isFocused: focused, send, repeat: 'appearance' });

  useEffect(() => {
    if (canPublish || pops.length === 0) return;

    setVisible([{ id: pops[activeIndex].id }]);
  }, [activeIndex, canPublish, pops, setVisible]);
}

/** Подгрузка соседних страниц ленты, когда активная подошла к краю загруженного. */
export function usePopFeedPaging(feed: ReturnType<typeof usePopFeed>, activeIndex: number) {
  const { pops, hasNextPage, hasPreviousPage, isFetchingNextPage, isFetchingPreviousPage } = feed;
  const { fetchNextPage, fetchPreviousPage } = feed;

  useEffect(() => {
    if (activeIndex >= pops.length - PREFETCH_PAGES && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }

    if (activeIndex < PREFETCH_PAGES && hasPreviousPage && !isFetchingPreviousPage) {
      void fetchPreviousPage();
    }
  }, [
    activeIndex,
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
    pops.length,
  ]);
}
