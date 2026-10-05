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
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { panelGeometry, type PanelGeometry } from './panelGeometry';

import {
  CLOSE_DURATION_MS,
  OPEN_SPRING,
  shouldDismissSheet,
  useDismissGesture,
} from '@/components/ScrollSheet';
import { useOwnKeyboardHeight } from '@/features/chats/composerKeyboard';
import { chatFade, liftedRowKey } from '@/features/interactions/comments/commentsLift';
import { closeComments } from '@/features/interactions/comments/commentsPanelStore';

/** Жест закрытия панели — снаружи нужен только тестам. */
export const PANEL_PAN_TEST_ID = 'comments-panel-pan';
/** Жест шапки панели — для тестов. */
export const HEADER_PAN_TEST_ID = 'comments-header-pan';

/** Жест шапки считается вертикальным после этого сдвига — тап по крестику доживает до кнопки. */
const HEADER_ACTIVATION_PX = 8;

/** Быстрее этого уход вниз не бывает, как бы быстро ни бросили. */
const MIN_CLOSE_MS = 120;
/** Дольше этого закрытие не ждёт замера переписки: шит уезжает со старым. */
const PREPARE_WAIT_MS = 120;

/**
 * Сколько ехать вниз после броска: со скоростью пальца, чтобы уход был одним
 * непрерывным движением, но не дольше обычного закрытия.
 */
function closeDuration(distance: number, velocityY: number): number {
  'worklet';

  if (velocityY <= 0) return CLOSE_DURATION_MS;

  return Math.max(MIN_CLOSE_MS, Math.min(CLOSE_DURATION_MS, (distance / velocityY) * 1000));
}

function withTimeout(task: Promise<void>, ms: number): Promise<void> {
  return Promise.race([task, new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

type Options = {
  windowHeight: number;
  /**
   * Перед тем как шит поедет вниз — перемерить место сообщения в переписке:
   * пока шит был открыт, могли прийти новые сообщения.
   */
  prepareClose: () => Promise<void>;
};

export type PanelSheet = ReturnType<typeof usePanelSheet>;

/**
 * Механика шита комментариев. Положение одно — верх на четверти экрана
 * (`panelGeometry`); выше шит не поднимается, поэтому свайп вверх сразу
 * листает комментарии. Вниз шит тянет жест закрытия — тот же, что у шита
 * медиа: список сначала докручивается до верха, и дальше палец без паузы
 * ведёт шит. За шапку шит тянется вниз сразу.
 */
export function usePanelSheet({ windowHeight, prepareClose }: Options) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useOwnKeyboardHeight('comments');
  const [headerHeight, setHeaderHeight] = useState(0);
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState(false);
  const [scrollAttached, setScrollAttached] = useState(false);

  const geometry: PanelGeometry = useMemo(
    () => panelGeometry(windowHeight, insets.top, PixelRatio.get()),
    [insets.top, windowHeight],
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

  // Выезжает, когда окно на экране и сообщение над шитом готово — копия
  // стоит ровно на месте строки.
  useEffect(() => {
    if (!shown || !ready || started.current) return;

    started.current = true;
    dismissY.value = withSpring(0, OPEN_SPRING);
  }, [dismissY, ready, shown]);

  const leave = useCallback(
    (velocityY: number) => {
      dismissY.value = withTiming(
        windowHeight,
        { duration: closeDuration(windowHeight - dismissY.value, velocityY) },
        (finished) => {
          if (!finished) return;

          // Строка возвращается, копия исчезает, переписка видна — в одном кадре.
          liftedRowKey.value = null;
          chatFade.value = 1;
          runOnJS(closeComments)();
        },
      );
    },
    [dismissY, windowHeight],
  );

  /** Закрыть: крестик, «назад», тап по фону или по сообщению над шитом. */
  const close = useCallback(() => {
    if (closing.value) return;

    closing.value = true;
    void KeyboardController.dismiss();
    void withTimeout(prepareClose(), PREPARE_WAIT_MS).then(() => leave(0));
  }, [closing, leave, prepareClose]);

  /** Отпустили, утащив вниз: место сообщения перемерено, когда палец взялся за шит. */
  const release = useCallback(
    (velocityY = 0) => {
      if (closing.value) return;

      closing.value = true;
      void KeyboardController.dismiss();
      leave(velocityY);
    },
    [closing, leave],
  );

  const releaseNow = useCallback(() => release(), [release]);
  const closeNow = useCallback(() => close(), [close]);
  const prepare = useCallback(() => void prepareClose(), [prepareClose]);

  const dismissPan = useDismissGesture({
    dismissY,
    scrollOffset,
    dismissing,
    scrollGestureRef,
    scrollAttached,
    dismissDistance: geometry.dismissDistance,
    onRelease: releaseNow,
    testId: PANEL_PAN_TEST_ID,
  });

  // Палец взялся за шит — переписку перемерить, пока он не уехал далеко.
  useAnimatedReaction(
    () => dismissing.value,
    (now, before) => {
      if (now && !before) runOnJS(prepare)();
    },
  );

  /**
   * Шапка лежит слоем над списком, и касание по ней до скролла не доходит.
   * Её жест тянет шит вниз сразу, где бы ни был список, а вверх — никуда:
   * выше рабочего положения шита нет. Жест закрытия на это время молчит.
   */
  const headerAnchor = useSharedValue(0);
  const headerPan = useMemo(
    () =>
      Gesture.Pan()
        .withTestId(HEADER_PAN_TEST_ID)
        .activeOffsetY([-HEADER_ACTIVATION_PX, HEADER_ACTIVATION_PX])
        .blocksExternalGesture(dismissPan)
        .onStart((event) => {
          headerAnchor.value = event.translationY - dismissY.value;
          runOnJS(prepare)();
        })
        .onUpdate((event) => {
          if (closing.value) return;

          dismissY.value = Math.max(0, event.translationY - headerAnchor.value);
        })
        .onEnd((event) => {
          if (closing.value) return;

          if (shouldDismissSheet(dismissY.value, geometry.dismissDistance, event.velocityY)) {
            runOnJS(release)(event.velocityY);
            return;
          }

          dismissY.value = withSpring(0, OPEN_SPRING);
        }),
    [closing, dismissPan, dismissY, geometry.dismissDistance, headerAnchor, prepare, release],
  );

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
    headerPan,
    shiftStyle,
    footerStyle,
    close,
    closeNow,
    markScrollAttached,
    markShown,
    markReady,
  };
}
