import { useIsFocused, useRouter } from '@/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, useWindowDimensions } from 'react-native';
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
const CLOSE_SHARE = 0.4;
/** Скорость броска вправо, dp/с, которая закрывает страницу и с короткого хода. */
const CLOSE_VELOCITY = 800;
/** Сдвиг пальца вправо, с которого жест узнаёт себя. */
const ACTIVATION_X = 14;
/** Вертикальный сдвиг раньше этого отдаёт касание прокрутке. */
const FAIL_Y = 12;

/**
 * Уход со страницы требует ответа (правка сообщения: «выйти без
 * сохранения?»). `null` — уходить можно сразу; обещание — страница сначала
 * встаёт на место и уходит, только если ответ «да».
 */
export type LeaveGuard = () => Promise<boolean> | null;

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
  /**
   * Системное «назад» сначала спрашивает этих: вернул `true` — «назад»
   * забрано (выход из выбора, из правки), страница остаётся. Последний
   * добавленный спрашивается первым. Отдаёт снятие.
   */
  interceptBack: (handler: () => boolean) => () => void;
  /** Спросить перед уходом. Отдаёт снятие. */
  guardLeave: (guard: LeaveGuard) => () => void;
  /** Свайп страницы узнал себя: убрать клавиатуру и панели под пальцем. Отдаёт снятие. */
  onSwipeStart: (listener: () => void) => () => void;
  /**
   * Пока держат, свайп страницы не начинается (идёт запись голосового с
   * замком: палец уже отпущен, а уводить страницу нельзя). Отдаёт снятие.
   */
  holdSwipe: () => () => void;
};

/**
 * Страница, которая въезжает справа и уезжает за пальцем. Экран открыт
 * прозрачным поверх предыдущего и без анимации стека: движение целиком здесь,
 * предыдущий экран под ним остаётся на своём месте и виден, пока страницу
 * тянут.
 *
 * Свайп от самого края на Android с жестовой навигацией забирает система:
 * где она отдаёт ход жеста (predictive back), страница едет за ним через
 * модуль `back-gesture`. Где не отдаёт (realme выключает его сторонним
 * приложениям), жест от края закрывает страницу анимацией ухода, а за пальцем
 * она едет от свайпа вправо внутри экрана — `makeSwipe`.
 */
export function useSlideBack(fallback?: () => void): SlideBack {
  const router = useRouter();
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const offset = useSharedValue(width);
  const leaving = useRef(false);
  /** Страница уходит: тянуть её пальцем уже нельзя, иначе уход оборвался бы. */
  const leavingNow = useSharedValue(false);
  /** Где был палец в начале системного жеста: страница едет на разницу. */
  const gestureStart = useSharedValue(0);
  // Списки на всё время жизни страницы: меняются без перерисовки. Не ref:
  // их читают и обработчики жестов.
  const [backHandlers] = useState<(() => boolean)[]>(() => []);
  const [guards] = useState<LeaveGuard[]>(() => []);
  const [swipeListeners] = useState<(() => void)[]>(() => []);

  // Под страницей может не оказаться экрана (открыли ссылкой с холодного
  // старта) — тогда уйти туда, куда скажет владелец.
  const finish = useCallback(() => {
    if (router.canGoBack()) router.back();
    else fallback?.();
  }, [fallback, router]);

  const settle = useCallback(() => {
    offset.set(withSpring(0, Motion.pageSpring));
  }, [offset]);

  const leave = useCallback(() => {
    if (leaving.current) return;

    leaving.current = true;
    leavingNow.set(true);
    offset.set(
      withTiming(width, { duration: Motion.pageMs, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(finish)();
      }),
    );
  }, [finish, leavingNow, offset, width]);

  /** Идёт вопрос перед уходом: второй не задаётся. */
  const asking = useRef(false);

  const close = useCallback(() => {
    if (leaving.current || asking.current) return;

    for (let i = guards.length - 1; i >= 0; i--) {
      const answer = guards[i]();

      if (!answer) continue;

      asking.current = true;
      let answered = false;

      // Ответ без вопроса (ничего не изменено) приходит сразу — страница
      // уходит дальше, не дёрнувшись. Пока спрашивают — стоит на месте, а не
      // висит на полпути.
      requestAnimationFrame(() => {
        if (!answered) settle();
      });
      void answer.then((yes) => {
        answered = true;
        asking.current = false;
        if (yes) leave();
        else settle();
      });
      return;
    }

    leave();
  }, [guards, leave, settle]);

  const back = useCallback(() => {
    for (let i = backHandlers.length - 1; i >= 0; i--) {
      if (backHandlers[i]()) return;
    }

    close();
  }, [backHandlers, close]);

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
        // «Назад» заберёт кто-то на странице — она за жестом не едет.
        if (leaving.current || backHandlers.length > 0) return;

        const shift =
          event.edge === 'left'
            ? event.touchX - gestureStart.get()
            : gestureStart.get() - event.touchX;

        offset.set(Math.max(0, shift));
      },
      onCancel: settle,
      onBack: () => {
        if (backHandlers.length > 0) settle();
        back();
      },
    });
  }, [back, backHandlers, focused, gestureStart, offset, settle]);

  // Где система не пускает «назад» через диспетчер (realme с выключенным
  // predictive back), кнопка и жест приходят в React Native обычным
  // `hardwareBackPress` — и тоже уводят страницу анимацией, а не рывком.
  useEffect(() => {
    if (!focused) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });

    return () => subscription.remove();
  }, [back, focused]);

  const swipeStarted = useCallback(() => {
    swipeListeners.forEach((listener) => listener());
  }, [swipeListeners]);

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const holds = useSharedValue(0);

  const holdSwipe = useCallback(() => {
    holds.set(holds.get() + 1);
    let released = false;

    return () => {
      if (released) return;

      released = true;
      holds.set(Math.max(0, holds.get() - 1));
    };
  }, [holds]);

  const makeSwipe = useCallback(
    (canStart: SharedValue<boolean>) =>
      Gesture.Pan()
        // Узнаёт себя сам: только вправо и только когда можно тянуть
        // страницу. Влево и вбок — сразу отказ, касание достаётся вкладкам и
        // прокрутке.
        .manualActivation(true)
        .onTouchesDown((event, manager) => {
          if (!canStart.value || leavingNow.value || holds.value > 0) {
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
        .onStart(() => {
          runOnJS(swipeStarted)();
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
    [close, holds, leavingNow, offset, startX, startY, swipeStarted, width],
  );

  const interceptBack = useCallback(
    (handler: () => boolean) => addTo(backHandlers, handler),
    [backHandlers],
  );
  const guardLeave = useCallback((guard: LeaveGuard) => addTo(guards, guard), [guards]);
  const onSwipeStart = useCallback(
    (listener: () => void) => addTo(swipeListeners, listener),
    [swipeListeners],
  );

  return useMemo(
    () => ({ offset, close, makeSwipe, interceptBack, guardLeave, onSwipeStart, holdSwipe }),
    [close, guardLeave, holdSwipe, interceptBack, makeSwipe, offset, onSwipeStart],
  );
}

function addTo<T>(list: T[], item: T): () => void {
  list.push(item);

  return () => {
    const at = list.lastIndexOf(item);

    if (at !== -1) list.splice(at, 1);
  };
}
