import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { recordPopViews, type Pop } from '@/api/pops';
import { channelSubscriptionQueryKey } from '@/features/channels/keys';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import type { PopFeed } from '@/features/pops/PopViewer/popFeed';
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
 *
 * Канал — у каждого попа свой: лента выдачи поиска листает попсы многих
 * каналов. `rights` — право в канале активного попа; пока ответа нет, показ
 * ждёт его, а прежний поп уже не считается видимым. Спросить не удалось —
 * показ уходит как от постороннего: публикующих база всё равно не засчитает.
 */
export function usePopViewCounting(
  pops: Pop[],
  activeIndex: number,
  rights: { canPublish: boolean; known: boolean; failed: boolean },
  focused: boolean,
) {
  const { canPublish, known, failed } = rights;
  const queryClient = useQueryClient();
  const send = useCallback(
    (items: { id: string; channelId: string }[], sessionId: string) =>
      recordPopViews(
        items.map(({ id }) => id),
        sessionId,
      ).then(() => {
        const subscribed = [...new Set(items.map((item) => item.channelId))].filter(
          // Постороннему прочитывать нечего — и перечитывать «Чаты» на каждый
          // свайп незачем.
          (channelId) => queryClient.getQueryData(channelSubscriptionQueryKey(channelId)),
        );

        if (subscribed.length === 0) return;

        subscribed.forEach((channelId) => {
          void queryClient.invalidateQueries({ queryKey: channelSubscriptionQueryKey(channelId) });
        });
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      }),
    [queryClient],
  );
  const { setVisible } = useViewBatcher({ isFocused: focused, send, repeat: 'appearance' });

  useEffect(() => {
    if ((!known && !failed) || canPublish || pops.length === 0) {
      setVisible([]);
      return;
    }

    const { id, channelId } = pops[activeIndex];

    setVisible([{ id, channelId }]);
  }, [activeIndex, canPublish, failed, known, pops, setVisible]);
}

/** Подгрузка соседних страниц ленты, когда активная подошла к краю загруженного. */
export function usePopFeedPaging(feed: PopFeed, activeIndex: number) {
  const { pops, hasNextPage, hasPreviousPage, isFetchingNextPage, isFetchingPreviousPage } = feed;
  const { fetchNextPage, fetchPreviousPage } = feed;

  useEffect(() => {
    // По одной стороне за раз: догрузка запроса отменяет идущую, и страницы
    // в обе стороны сразу перебивали бы друг друга без конца.
    if (isFetchingNextPage || isFetchingPreviousPage) return;

    if (activeIndex >= pops.length - PREFETCH_PAGES && hasNextPage) {
      void fetchNextPage();
    } else if (activeIndex < PREFETCH_PAGES && hasPreviousPage) {
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
