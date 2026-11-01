// Боковая панель на низкоуровневом API Reanimated: мутация `.value` у shared
// value — штатный способ им пользоваться (см. `usePanelSheet`).
/* eslint-disable react-hooks/immutability */
import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import type { ScrollView, ViewStyle } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { KeyboardController } from 'react-native-keyboard-controller';
import {
  Easing,
  runOnJS,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PanelSheet, SheetPane } from './usePanelSheet';

import { useOwnKeyboardHeight } from '@/features/chats/composerKeyboard';
import { closeComments } from '@/features/interactions/comments/commentsPanelStore';

/** Тест ищет жест закрытия по этому id. */
export const SIDE_PANEL_PAN_TEST_ID = 'fragment-panel-pan';

const OPEN_MS = 260;
const CLOSE_MS = 220;
/** Быстрее этого уход вправо не бывает, как бы быстро ни бросили. */
const MIN_CLOSE_MS = 90;
/** Сдвиг пальца вправо, с которого жест — закрытие, а не касание. */
const ACTIVATION = 12;
/** Вертикальный сдвиг, после которого это прокрутка, а не закрытие. */
const FAIL_Y = 12;
/** Утащили на эту долю ширины — отпускание закрывает. */
const DISMISS_SHARE = 0.35;
/** Бросок вправо быстрее этого (dp/с) закрывает с любого места. */
const FLING_VELOCITY = 700;

const EASE_OUT = Easing.out(Easing.cubic);

type Options = {
  /** Ширина панели: она же путь выезда. */
  width: number;
  windowHeight: number;
  /** Панель уехала — убрать её из стора. По умолчанию — панель комментариев. */
  onClosed?: () => void;
};

function useStillPane(): SheetPane {
  const scrollOffset = useSharedValue(0);
  const animatedRef = useAnimatedRef<ScrollView>();
  const scrollGestureRef = useRef<ComponentType | null>(null);
  const listRef = useRef<FlashListRef<unknown>>(null);
  const dismissPan = useMemo(() => Gesture.Pan().enabled(false), []);
  const markScrollAttached = useCallback(() => undefined, []);
  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    scrollOffset.value = 0;
  }, [scrollOffset]);

  return {
    animatedRef,
    scrollGestureRef,
    scrollOffset,
    listRef,
    dismissPan,
    markScrollAttached,
    scrollToTop,
  };
}

/**
 * Механика боковой панели фрагмента — тот же набор, что у шита
 * (`usePanelSheet`), чтобы внутри жило то же содержимое комментариев. Панель
 * въезжает справа и уходит вправо: тапом по затемнению, «назад» и свайпом
 * вправо по списку — медленным до порога или броском.
 */
export function useSidePanel({ width, windowHeight, onClosed = closeComments }: Options): PanelSheet & {
  /** Панель доехала — можно отдавать фокус полю ввода. */
  opened: boolean;
} {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useOwnKeyboardHeight('comments');
  const [headerHeight, setHeaderHeight] = useState(0);
  const [shown, setShown] = useState(false);
  const [opened, setOpened] = useState(false);
  const offset = useSharedValue(width);
  const closing = useSharedValue(false);
  const dismissY = useSharedValue(0);
  const dismissing = useSharedValue(false);
  const started = useRef(false);

  const geometry = useMemo(
    () => ({ top: insets.top, height: windowHeight - insets.top, dismissDistance: width * DISMISS_SHARE }),
    [insets.top, width, windowHeight],
  );

  const markOpened = useCallback(() => setOpened(true), []);

  useEffect(() => {
    if (!shown || started.current) return;

    started.current = true;
    offset.value = withTiming(0, { duration: OPEN_MS, easing: EASE_OUT }, (finished) => {
      if (finished) runOnJS(markOpened)();
    });
  }, [markOpened, offset, shown]);

  const leave = useCallback(
    (velocityX: number) => {
      'worklet';

      const rest = width - offset.value;
      const duration =
        velocityX > 0
          ? Math.max(MIN_CLOSE_MS, Math.min(CLOSE_MS, (rest / velocityX) * 1000))
          : CLOSE_MS;

      offset.value = withTiming(width, { duration, easing: EASE_OUT }, (finished) => {
        if (finished) runOnJS(onClosed)();
      });
    },
    [offset, onClosed, width],
  );

  const close = useCallback(() => {
    if (closing.value) return;

    closing.value = true;
    void KeyboardController.dismiss();
    leave(0);
  }, [closing, leave]);

  const dismissKeyboard = useCallback(() => void KeyboardController.dismiss(), []);

  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .withTestId(SIDE_PANEL_PAN_TEST_ID)
        .activeOffsetX(ACTIVATION)
        .failOffsetY([-FAIL_Y, FAIL_Y])
        .onUpdate((event) => {
          if (closing.value) return;

          offset.value = Math.min(width, Math.max(0, event.translationX));
        })
        .onEnd((event) => {
          if (closing.value) return;

          if (offset.value >= width * DISMISS_SHARE || event.velocityX >= FLING_VELOCITY) {
            closing.value = true;
            runOnJS(dismissKeyboard)();
            leave(Math.max(event.velocityX, 0));
            return;
          }

          offset.value = withTiming(0, { duration: CLOSE_MS, easing: EASE_OUT });
        }),
    [closing, dismissKeyboard, leave, offset, width],
  );

  const mainPane = useStillPane();
  const commentThread = useStillPane();
  const main = useMemo(() => ({ ...mainPane, dismissPan: swipe }), [mainPane, swipe]);
  const headerPan = useMemo(() => Gesture.Pan().enabled(false), []);

  const shiftStyle = useAnimatedStyle((): ViewStyle => ({ transform: [{ translateX: offset.value }] }));
  const footerStyle = useAnimatedStyle((): ViewStyle => ({
    transform: [
      { translateX: offset.value },
      { translateY: -Math.max(keyboardHeight.value - insets.bottom, 0) },
    ],
  }));
  const backdropStyle = useAnimatedStyle((): ViewStyle => ({ opacity: 1 - offset.value / width }));

  const markShown = useCallback(() => setShown(true), []);

  return {
    geometry,
    headerHeight,
    setHeaderHeight,
    dismissY,
    dismissing,
    main,
    commentThread,
    headerPan,
    shiftStyle,
    footerStyle,
    close,
    closeNow: close,
    markShown,
    backdropStyle,
    opened,
  };
}
