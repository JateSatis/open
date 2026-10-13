import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { backGestureAvailable, interceptBackGesture } from '../../../modules/back-gesture';

import { Motion } from '@/theme';

/** Свайп за пределы этой доли ширины (или бросок) закрывает страницу. */
const CLOSE_SHARE = 0.35;
/** Скорость броска вправо, dp/с, которая закрывает страницу и с короткого хода. */
const CLOSE_VELOCITY = 800;
/** Сдвиг пальца вправо, с которого жест узнаёт себя. */
const ACTIVATION_X = 14;
/** Вертикальный сдвиг раньше этого отдаёт касание прокрутке. */
const FAIL_Y = 12;

export type SlideBack = {
  /** Сдвиг страницы вправо, dp: 0 — на месте, ширина экрана — ушла. */
  offset: SharedValue<number>;
  /** Уйти назад той же анимацией, что и свайпом. */
  close: () => void;
  /**
   * Свайп вправо, который тянет страницу за пальцем. `canStart` — на UI-потоке,
   * в начале касания: можно ли сейчас тянуть страницу, а не листать вкладки.
   */
  makeSwipe: (canStart: SharedValue<boolean>) => ReturnType<typeof Gesture.Pan>;
};

/**
 * Страница, которая въезжает справа и уезжает за пальцем. Экран открыт
 * прозрачным поверх переписки и без анимации стека: движение целиком здесь,
 * переписка под ним остаётся на своём месте и видна, пока страницу тянут.
 *
 * Свайп от самого края на Android с жестовой навигацией забирает система:
 * где она отдаёт ход жеста (predictive back), страница едет за ним через
 * модуль `back-gesture`. Где не отдаёт (realme выключает его сторонним
 * приложениям), жест от края закрывает страницу анимацией ухода, а за пальцем
 * она едет от свайпа вправо внутри экрана — `makeSwipe`.
 */
export function useSlideBack(): SlideBack {
  const router = useRouter();
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const offset = useSharedValue(width);
  const leaving = useRef(false);
  /** Где был палец в начале системного жеста: страница едет на разницу. */
  const gestureStart = useSharedValue(0);

  const finish = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const close = useCallback(() => {
    if (leaving.current) return;

    leaving.current = true;
    offset.set(
      withTiming(width, { duration: Motion.pageMs, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(finish)();
      }),
    );
  }, [finish, offset, width]);

  const settle = useCallback(() => {
    offset.set(withSpring(0, Motion.pageSpring));
  }, [offset]);

  useEffect(() => {
    offset.set(withTiming(0, { duration: Motion.pageMs, easing: Easing.out(Easing.cubic) }));
  }, [offset]);

  useEffect(() => {
    if (!focused || !backGestureAvailable) return;

    return interceptBackGesture({
      onStart: (event) => {
        gestureStart.set(event.touchX);
      },
      onProgress: (event) => {
        if (leaving.current) return;

        const shift =
          event.edge === 'left'
            ? event.touchX - gestureStart.get()
            : gestureStart.get() - event.touchX;

        offset.set(Math.max(0, shift));
      },
      onCancel: settle,
      onBack: close,
    });
  }, [close, focused, gestureStart, offset, settle]);

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const makeSwipe = useCallback(
    (canStart: SharedValue<boolean>) =>
      Gesture.Pan()
        // Узнаёт себя сам: только вправо и только когда можно тянуть
        // страницу. Влево и вбок — сразу отказ, касание достаётся вкладкам и
        // прокрутке.
        .manualActivation(true)
        .onTouchesDown((event, manager) => {
          if (!canStart.value) {
            manager.fail();
            return;
          }

          startX.set(event.allTouches[0]?.absoluteX ?? 0);
          startY.set(event.allTouches[0]?.absoluteY ?? 0);
        })
        .onTouchesMove((event, manager) => {
          const touch = event.allTouches[0];

          if (!touch) return;

          const dx = touch.absoluteX - startX.value;
          const dy = touch.absoluteY - startY.value;

          if (Math.abs(dy) > FAIL_Y && Math.abs(dy) > Math.abs(dx)) manager.fail();
          else if (dx < -ACTIVATION_X / 2) manager.fail();
          else if (dx > ACTIVATION_X) manager.activate();
        })
        .onUpdate((event) => {
          offset.set(Math.max(0, event.translationX));
        })
        .onEnd((event) => {
          if (offset.get() > width * CLOSE_SHARE || event.velocityX > CLOSE_VELOCITY) {
            runOnJS(close)();
          } else {
            offset.set(withSpring(0, Motion.pageSpring));
          }
        }),
    [close, offset, startX, startY, width],
  );

  return useMemo(() => ({ offset, close, makeSwipe }), [close, makeSwipe, offset]);
}
