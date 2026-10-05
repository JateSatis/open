// Шит на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться, а не нарушение чистоты, которое видит в
// этом React Compiler.
/* eslint-disable react-hooks/immutability */
import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { PixelRatio, type ScrollView } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { KeyboardController } from 'react-native-keyboard-controller';
import {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { panelGeometry, type PanelGeometry } from './panelGeometry';

import { CLOSE_DURATION_MS, OPEN_SPRING, useDismissGesture } from '@/components/ScrollSheet';
import { useOwnKeyboardHeight } from '@/features/chats/composerKeyboard';
import {
  closeComments,
  setPanelRestTop,
} from '@/features/interactions/comments/commentsPanelStore';

/** Жест закрытия панели — снаружи нужен только тестам. */
export const PANEL_PAN_TEST_ID = 'comments-panel-pan';
/** Жест шапки панели — для тестов. */
export const HEADER_PAN_TEST_ID = 'comments-header-pan';

/** Жест шапки считается вертикальным после этого сдвига — тапы по сообщению доживают до своих кнопок. */
const HEADER_ACTIVATION_PX = 8;

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

  /**
   * Шапка лежит слоем над списком, и касание по ней до скролла не доходит —
   * её жест ведёт тот же скролл сам: палец двигает шит между серединой и
   * верхом, бросок продолжается инерцией. Ниже середины шит тянет жест
   * закрытия — он работает одновременно с этим.
   */
  const headerScroll = useSharedValue(0);
  const headerDriving = useSharedValue(false);
  const headerStart = useSharedValue(0);
  const travel = geometry.travel;

  useAnimatedReaction(
    () => (headerDriving.value ? headerScroll.value : -1),
    (target) => {
      if (target >= 0) scrollTo(animatedRef, 0, target, false);
    },
  );

  const headerPan = useMemo(
    () =>
      Gesture.Pan()
        .withTestId(HEADER_PAN_TEST_ID)
        .activeOffsetY([-HEADER_ACTIVATION_PX, HEADER_ACTIVATION_PX])
        .simultaneousWithExternalGesture(dismissPan)
        .onBegin(() => {
          cancelAnimation(headerScroll);
          headerDriving.value = false;
        })
        .onStart(() => {
          // Листание комментариев шапка не трогает: она ведёт только шит.
          headerStart.value = Math.min(scrollOffset.value, travel);
          headerScroll.value = headerStart.value;
          headerDriving.value = true;
        })
        .onUpdate((event) => {
          headerScroll.value = Math.min(Math.max(headerStart.value - event.translationY, 0), travel);
        })
        .onEnd((event) => {
          if (dismissing.value) {
            headerDriving.value = false;
            return;
          }

          headerScroll.value = withDecay(
            { velocity: -event.velocityY, clamp: [0, travel] },
            () => {
              headerDriving.value = false;
            },
          );
        }),
    [dismissPan, dismissing, headerDriving, headerScroll, headerStart, scrollOffset, travel],
  );

  const markScrollAttached = useCallback(() => setScrollAttached(true), []);
  const markShown = useCallback(() => setShown(true), []);
  const markReady = useCallback(() => setReady(true), []);

  // Где встанет шит — переписке под ним, чтобы поставить сообщение над ним.
  const restTop = ready ? geometry.top + geometry.travel : null;

  useEffect(() => {
    if (restTop === null) return;

    setPanelRestTop(restTop);

    return () => setPanelRestTop(null);
  }, [restTop]);

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
    headerPan,
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
