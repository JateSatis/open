// Мутация `.value` у shared value — штатный API Reanimated, а не нарушение
// чистоты, которое видит в этом React Compiler.
/* eslint-disable react-hooks/immutability */
import { useEffect } from 'react';
import type { NativeScrollEvent, ScrollView } from 'react-native';
import {
  scrollTo,
  useEvent,
  type AnimatedRef,
  type ReanimatedEvent,
  type SharedValue,
} from 'react-native-reanimated';


const SCROLL_EVENTS = [
  'onScroll',
  'onScrollBeginDrag',
  'onScrollEndDrag',
  'onMomentumScrollBegin',
  'onMomentumScrollEnd',
];

/** Внутренность `useEvent`, которой пользуется и сам `useScrollOffset`, — в типах её нет. */
type RegistrableHandler = {
  workletEventHandler: {
    registerForEvents: (viewTag: number) => void;
    unregisterFromEvents: (viewTag: number) => void;
  };
};

/**
 * Позиция скролла списка — на UI-потоке, в тот же кадр, что и сам скролл.
 *
 * Читает её жест закрытия, и читает в каждом кадре движения пальца: именно по
 * ней он понимает, что список упёрся в верх и дальше палец тянет уже шит.
 * Запись с JS-потока здесь не годится — сразу после открытия он занят
 * монтированием и чтением галереи, и жест видел бы позицию с опозданием.
 *
 * Подписка идёт по нативному тегу скролла, как у `useScrollOffset`, а не через
 * проп `onScroll`: этот проп занят самим `FlashList`, он считает по нему
 * видимое окно.
 *
 * Пока шит тянут вниз, список держится в нуле. Держать его приходится здесь,
 * после того как скролл уже применил движение пальца: попытка сделать это из
 * жеста проигрывала бы скроллу, который обрабатывает то же касание позже, и
 * в кадр попадал бы сдвиг списка.
 */
export function useSheetScroll(
  animatedRef: AnimatedRef<ScrollView>,
  scrollOffset: SharedValue<number>,
  dismissing: SharedValue<boolean>,
) {
  const handler = useEvent<ReanimatedEvent<NativeScrollEvent>>(
    (event) => {
      'worklet';
      const y = event.contentOffset.y;

      if (dismissing.value && y > 0) {
        scrollTo(animatedRef, 0, 0, false);
        scrollOffset.value = 0;
        return;
      }

      scrollOffset.value = y;
    },
    SCROLL_EVENTS,
  ) as unknown as RegistrableHandler;

  useEffect(
    () =>
      animatedRef.observe((tag) => {
        if (typeof tag !== 'number') return;

        handler.workletEventHandler.registerForEvents(tag);

        return () => handler.workletEventHandler.unregisterFromEvents(tag);
      }),
    [animatedRef, handler],
  );
}
