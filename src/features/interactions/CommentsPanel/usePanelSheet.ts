// Шит на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться, а не нарушение чистоты, которое видит в
// этом React Compiler.
/* eslint-disable react-hooks/immutability */
import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { PixelRatio, type ScrollView, type ViewStyle } from 'react-native';
import { Gesture, type PanGesture } from 'react-native-gesture-handler';
import { KeyboardController } from 'react-native-keyboard-controller';
import {
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type AnimatedRef,
  type SharedValue,
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
import {
  commentsSheetOpen,
  commentsSheetTop,
} from '@/features/interactions/comments/commentsSheetMotion';
import { closeComments } from '@/features/interactions/comments/commentsPanelStore';

/** Жест закрытия панели на основном списке — снаружи нужен только тестам. */
export const PANEL_PAN_TEST_ID = 'comments-panel-pan';
/** Тот же жест на списке окна треда. */
export const COMMENT_THREAD_PAN_TEST_ID = 'comment-thread-pan';
/** Жест шапки панели — для тестов. */
export const HEADER_PAN_TEST_ID = 'comments-header-pan';

/** Жест шапки считается вертикальным после этого сдвига — тап по стрелке треда доживает до кнопки. */
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

type Options = {
  windowHeight: number;
};

export type PanelSheet = ReturnType<typeof usePanelSheet>;

/**
 * Список внутри шита и его связь с жестом закрытия: своя позиция скролла,
 * своя ссылка на нативный скролл и свой жест. Списков два — основной и окно
 * треда, — и шит тянет тот, на котором палец: касание по окну треда двигает
 * шит, только когда докручен до верха список треда.
 */
export type SheetPane = {
  animatedRef: AnimatedRef<ScrollView>;
  scrollGestureRef: { current: ComponentType | null };
  scrollOffset: SharedValue<number>;
  listRef: { current: FlashListRef<unknown> | null };
  dismissPan: PanGesture;
  markScrollAttached: () => void;
  /** К началу списка — без анимации, вместе с позицией для жеста закрытия. */
  scrollToTop: () => void;
};

type PaneOptions = {
  dismissY: SharedValue<number>;
  dismissing: SharedValue<boolean>;
  dismissDistance: number;
  onRelease: () => void;
  testId: string;
};

function useSheetPane({
  dismissY,
  dismissing,
  dismissDistance,
  onRelease,
  testId,
}: PaneOptions): SheetPane {
  const [scrollAttached, setScrollAttached] = useState(false);
  const scrollOffset = useSharedValue(0);
  const animatedRef = useAnimatedRef<ScrollView>();
  const scrollGestureRef = useRef<ComponentType | null>(null);
  const listRef = useRef<FlashListRef<unknown>>(null);

  const dismissPan = useDismissGesture({
    dismissY,
    scrollOffset,
    dismissing,
    scrollGestureRef,
    scrollAttached,
    dismissDistance,
    onRelease,
    testId,
  });

  const markScrollAttached = useCallback(() => setScrollAttached(true), []);
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
 * Механика шита комментариев. Положение одно — верх на четверти экрана
 * (`panelGeometry`); выше шит не поднимается, поэтому свайп вверх сразу
 * листает комментарии. Вниз шит тянет жест закрытия — тот же, что у шита
 * медиа: список сначала докручивается до верха, и дальше палец без паузы
 * ведёт шит. За шапку шит тянется вниз сразу.
 */
export function usePanelSheet({ windowHeight }: Options) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useOwnKeyboardHeight('comments');
  const [headerHeight, setHeaderHeight] = useState(0);
  const [shown, setShown] = useState(false);

  const geometry: PanelGeometry = useMemo(
    () => panelGeometry(windowHeight, insets.top, PixelRatio.get()),
    [insets.top, windowHeight],
  );

  /** Насколько шит утащен вниз относительно рабочего положения: 0 — на месте. */
  const dismissY = useSharedValue(windowHeight);
  const dismissing = useSharedValue(false);
  const closing = useSharedValue(false);
  const started = useRef(false);

  // Ход шита — для экрана под ним (просмотр попа уменьшает видео над шитом).
  useEffect(() => {
    commentsSheetTop.value = geometry.top;
  }, [geometry.top]);

  useAnimatedReaction(
    () => dismissY.value,
    (shift) => {
      commentsSheetOpen.value = Math.min(Math.max(1 - shift / geometry.height, 0), 1);
    },
  );

  useEffect(
    () => () => {
      commentsSheetOpen.value = 0;
    },
    [],
  );

  // Выезжает, когда окно на экране: раньше пружина отыграла бы впустую.
  useEffect(() => {
    if (!shown || started.current) return;

    started.current = true;
    dismissY.value = withSpring(0, OPEN_SPRING);
  }, [dismissY, shown]);

  const leave = useCallback(
    (velocityY: number) => {
      dismissY.value = withTiming(
        windowHeight,
        { duration: closeDuration(windowHeight - dismissY.value, velocityY) },
        (finished) => {
          if (!finished) return;

          runOnJS(closeComments)();
        },
      );
    },
    [dismissY, windowHeight],
  );

  /** Закрыть: «назад» или тап по затемнению над шитом. */
  const close = useCallback(() => {
    if (closing.value) return;

    closing.value = true;
    void KeyboardController.dismiss();
    leave(0);
  }, [closing, leave]);

  /** Отпустили, утащив вниз. */
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

  const main = useSheetPane({
    dismissY,
    dismissing,
    dismissDistance: geometry.dismissDistance,
    onRelease: releaseNow,
    testId: PANEL_PAN_TEST_ID,
  });
  const commentThread = useSheetPane({
    dismissY,
    dismissing,
    dismissDistance: geometry.dismissDistance,
    onRelease: releaseNow,
    testId: COMMENT_THREAD_PAN_TEST_ID,
  });

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
        .blocksExternalGesture(main.dismissPan, commentThread.dismissPan)
        .onStart((event) => {
          headerAnchor.value = event.translationY - dismissY.value;
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
    [
      closing,
      dismissY,
      geometry.dismissDistance,
      headerAnchor,
      main.dismissPan,
      release,
      commentThread.dismissPan,
    ],
  );

  /** Весь шит целиком: и список, и строка ввода уезжают вместе. */
  // Стили — общего вида `ViewStyle`: боковая панель (`useSidePanel`) двигает
  // то же содержимое по горизонтали.
  const shiftStyle = useAnimatedStyle(
    (): ViewStyle => ({ transform: [{ translateY: dismissY.value }] }),
  );

  /**
   * Строка ввода — ровно над клавиатурой своего поля и уезжает вниз вместе
   * с шитом. Высота клавиатуры меряется от низа экрана и уже покрывает
   * полосу навигации, под которую у строки свой отступ.
   */
  const footerStyle = useAnimatedStyle(
    (): ViewStyle => ({
      transform: [
        { translateY: dismissY.value - Math.max(keyboardHeight.value - insets.bottom, 0) },
      ],
    }),
  );

  /** Затемнение под шитом — по его ходу: тянут вниз — светлеет за пальцем. */
  const backdropStyle = useAnimatedStyle(
    (): ViewStyle => ({ opacity: Math.min(Math.max(1 - dismissY.value / geometry.height, 0), 1) }),
  );

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
    backdropStyle,
    close,
    closeNow,
    markShown,
  };
}
