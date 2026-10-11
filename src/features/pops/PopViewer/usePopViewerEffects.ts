import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { recordPopViews, type Pop } from '@/api/pops';
import { channelSubscriptionQueryKey } from '@/features/channels/keys';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import type { usePopFeed } from '@/features/pops/usePopFeed';
import { useViewBatcher } from '@/lib/useViewBatcher';

/** Ближе этого к краю загруженного — подгружаем следующую страницу. */
const PREFETCH_PAGES = 3;

/**
 * Просмотр — сразу при показе: поп стал активной страницей. Ушёл и вернулся —
 * новый показ (сервер засчитает не чаще раза в 10 секунд). Свои не
 * отправляются: публикующим в канале база их всё равно не засчитает.
 *
 * Просмотренный поп подписчику прочитан — и в «Чатах», и на вкладке канала,
 * даже если в сам канал он не заходил.
 */
export function usePopViewCounting(
  channelId: string,
  pops: Pop[],
  activeIndex: number,
  canPublish: boolean,
  focused: boolean,
) {
  const queryClient = useQueryClient();
  const send = useCallback(
    (items: { id: string }[], sessionId: string) =>
      recordPopViews(
        items.map(({ id }) => id),
        sessionId,
      ).then(() => {
        // Постороннему прочитывать нечего — и перечитывать «Чаты» на каждый
        // свайп незачем.
        if (!queryClient.getQueryData(channelSubscriptionQueryKey(channelId))) return;

        void queryClient.invalidateQueries({ queryKey: channelSubscriptionQueryKey(channelId) });
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      }),
    [channelId, queryClient],
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
