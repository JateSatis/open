// Шит на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться, а не нарушение чистоты, которое видит в
// этом React Compiler.
/* eslint-disable react-hooks/immutability */
import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { PixelRatio, type ScrollView } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { panelGeometry, type PanelGeometry } from './panelGeometry';

import { CLOSE_DURATION_MS, OPEN_SPRING, useDismissGesture } from '@/components/ScrollSheet';
import { useOwnKeyboardHeight } from '@/features/chats/composerKeyboard';
import { closeComments } from '@/features/interactions/comments/commentsPanelStore';

/** Жест закрытия панели — снаружи нужен только тестам. */
export const PANEL_PAN_TEST_ID = 'comments-panel-pan';

/** Быстрее этого уход вниз не бывает, как бы быстро ни бросили. */
const MIN_CLOSE_MS = 120;

/**
 * Сколько ехать вниз после броска: со скоростью пальца, чтобы уход был одним
 * непрерывным движением, но не дольше обычного закрытия.
 */
function closeDuration(distance: number, velocityY: number): number {
  'worklet';

  if (velocityY <= 0) return CLOSE_DURATION_MS;

  return Math.max(MIN_CLOSE_MS, Math.min(CLOSE_DURATION_MS, (distance / velocityY) * 1000));
}

export type PanelSheet = ReturnType<typeof usePanelSheet>;

/**
 * Механика шита комментариев — та же, что у шита медиа: движением владеет
 * список. Над строками в содержимом лежит прозрачное начало высотой в ход
 * шита: пока скролл внутри него, едет шит, дальше листаются комментарии.
 * Поэтому подъём из середины переходит в листание одним жестом, бросок вверх
 * продолжается инерцией, а бросок вниз останавливается в середине — это одна
 * и та же нативная прокрутка. Ниже середины шит тянет жест закрытия.
 */
export function usePanelSheet(windowHeight: number) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useOwnKeyboardHeight('comments');
  const [headerHeight, setHeaderHeight] = useState(0);
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState(false);
  const [scrollAttached, setScrollAttached] = useState(false);

  const geometry: PanelGeometry = useMemo(
    () => panelGeometry(windowHeight, insets.top, headerHeight, PixelRatio.get()),
    [headerHeight, insets.top, windowHeight],
  );

  /** Насколько шит утащен вниз относительно рабочего положения: 0 — на месте. */
  const dismissY = useSharedValue(windowHeight);
  const scrollOffset = useSharedValue(0);
  const dismissing = useSharedValue(false);
  const closing = useSharedValue(false);
  const animatedRef = useAnimatedRef<ScrollView>();
  const scrollGestureRef = useRef<ComponentType | null>(null);
  const listRef = useRef<FlashListRef<unknown>>(null);
  const started = useRef(false);

  // Выезжает, когда окно на экране и шапка замерена: положения считаются по
  // её высоте, и шит встаёт в середину сразу, без подскока.
  useEffect(() => {
    if (!shown || !ready || started.current) return;

    started.current = true;
    dismissY.value = withSpring(0, OPEN_SPRING);
  }, [dismissY, ready, shown]);

  const close = useCallback(
    (velocityY = 0) => {
      if (closing.value) return;

      closing.value = true;
      void KeyboardController.dismiss();
      dismissY.value = withTiming(
        windowHeight,
        { duration: closeDuration(windowHeight - dismissY.value, velocityY) },
        (finished) => {
          if (finished) runOnJS(closeComments)();
        },
      );
    },
    [closing, dismissY, windowHeight],
  );

  const closeNow = useCallback(() => close(), [close]);

  /** Поле ввода в фокусе — шит наверх: комментариям нужно место над клавиатурой. */
  const expand = useCallback(() => {
    if (closing.value || scrollOffset.value >= geometry.travel) return;

    listRef.current?.scrollToOffset({ offset: geometry.travel, animated: true });
  }, [closing, geometry.travel, scrollOffset]);

  const dismissPan = useDismissGesture({
    dismissY,
    scrollOffset,
    dismissing,
    scrollGestureRef,
    scrollAttached,
    dismissDistance: geometry.dismissDistance,
    onRelease: closeNow,
    testId: PANEL_PAN_TEST_ID,
  });

  /** Весь шит целиком: и список, и строка ввода уезжают вместе. */
  const shiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissY.value }],
  }));

  /**
   * Строка ввода — ровно над клавиатурой своего поля и уезжает вниз вместе
   * с шитом. Высота клавиатуры меряется от низа экрана и уже покрывает
   * полосу навигации, под которую у строки свой отступ.
   */
  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissY.value - Math.max(keyboardHeight.value - insets.bottom, 0) }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dismissY.value, [0, geometry.halfHeight], [1, 0], Extrapolation.CLAMP),
  }));

  const markScrollAttached = useCallback(() => setScrollAttached(true), []);
  const markShown = useCallback(() => setShown(true), []);
  const markReady = useCallback(() => setReady(true), []);

  return {
    geometry,
    headerHeight,
    setHeaderHeight,
    dismissY,
    scrollOffset,
    dismissing,
    animatedRef,
    scrollGestureRef,
    listRef,
    dismissPan,
    shiftStyle,
    footerStyle,
    backdropStyle,
    close,
    closeNow,
    expand,
    markScrollAttached,
    markShown,
    markReady,
  };
}
