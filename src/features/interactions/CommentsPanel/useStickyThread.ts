// Мутация `.value` у shared value — штатный API Reanimated, а не нарушение
// чистоты, которое видит в этом React Compiler.
/* eslint-disable react-hooks/immutability */
import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { threadBounds, type CommentRow } from './rows';
import {
  headerBottom,
  isRootStuck,
  repliesHeight,
  scrollAfterCollapse,
  stickyRootTop,
  type ThreadLayout,
} from './stickyRoot';

type Options = {
  listRef: RefObject<FlashListRef<CommentRow> | null>;
  rows: CommentRow[];
  openThread: string | null;
  scrollOffset: SharedValue<number>;
  travel: number;
  headerHeight: number;
};

/**
 * Липкий корень раскрытого треда. Границы треда в содержимом меряются после
 * каждой раскладки списка (`onCommitLayoutEffect`), позиция копии — на
 * UI-потоке из позиции скролла: копия не отстаёт от строк ни на кадр.
 *
 * Скрытие треда с липкого корня сдвигает скролл так, что корень остаётся
 * там, где стояла копия. Сдвиг ставится в той же раскладке, в которой тред
 * схлопнулся, — до отрисовки кадра, как поправка позиции у самого
 * `FlashList`: промежуточного кадра нет.
 */
export function useStickyThread({
  listRef,
  rows,
  openThread,
  scrollOffset,
  travel,
  headerHeight,
}: Options) {
  const layout = useSharedValue<ThreadLayout | null>(null);
  const [stuck, setStuck] = useState(false);
  const pendingScroll = useRef<number | null>(null);
  const bounds = useMemo(() => threadBounds(rows, openThread), [openThread, rows]);

  const onCommitLayout = useCallback(() => {
    const list = listRef.current;

    if (list && pendingScroll.current !== null) {
      list.scrollToOffset({ offset: pendingScroll.current, animated: false });
      pendingScroll.current = null;
    }

    const first = bounds && list ? list.getLayout(bounds.first) : undefined;
    const last = bounds && list ? list.getLayout(bounds.last) : undefined;

    if (!list || !first || !last) {
      layout.value = null;
      return;
    }

    const offset = list.getFirstItemOffset();

    layout.value = {
      rootTop: offset + first.y,
      rootHeight: first.height,
      threadBottom: offset + last.y + last.height,
    };
  }, [bounds, layout, listRef]);

  useAnimatedReaction(
    () => {
      const current = layout.value;

      return current
        ? isRootStuck(current, headerBottom(scrollOffset.value, travel, headerHeight))
        : false;
    },
    (now, before) => {
      if (now !== before) runOnJS(setStuck)(now);
    },
  );

  const style = useAnimatedStyle(() => {
    const current = layout.value;

    if (!current) return { opacity: 0, transform: [{ translateY: 0 }] };

    const below = headerBottom(scrollOffset.value, travel, headerHeight);

    return {
      opacity: isRootStuck(current, below) ? 1 : 0,
      transform: [{ translateY: stickyRootTop(current, below) }],
    };
  });

  /**
   * Тред скрывается. С липкого корня — со сдвигом скролла, который
   * применится в раскладке схлопнутого списка.
   */
  const prepareCollapse = useCallback(() => {
    const current = layout.value;

    if (!current) return;

    const below = headerBottom(scrollOffset.value, travel, headerHeight);

    if (isRootStuck(current, below)) {
      pendingScroll.current = scrollAfterCollapse(current, scrollOffset.value, below);
    }
  }, [headerHeight, layout, scrollOffset, travel]);

  /**
   * Раскрывается другой тред, раскрытый закрывается. Если он выше нового
   * корня, его ответы уходят из содержимого над корнем — скролл сдвигается
   * ровно на их высоту, и новый корень на экране не двигается. Своя поправка
   * `FlashList` тут не помогает: она держит первую видимую строку, а это
   * часто ответ закрываемого треда.
   */
  const prepareSwitch = useCallback(
    (nextRootId: string) => {
      const current = layout.value;

      if (!current || !bounds) return;

      const next = rows.findIndex((row) => row.key === nextRootId);

      if (next <= bounds.last) return;

      // Шит наверху там и остаётся: если над новым корнем не хватает
      // содержимого, корень поднимется, но шапка и шит не сдвинутся.
      const floor = scrollOffset.value >= travel ? travel : 0;

      pendingScroll.current = Math.max(floor, scrollOffset.value - repliesHeight(current));
    },
    [bounds, layout, rows, scrollOffset, travel],
  );

  return {
    onCommitLayout,
    style,
    stuck,
    prepareCollapse,
    prepareSwitch,
    rootRow: bounds ? rows[bounds.first] : null,
  };
}
