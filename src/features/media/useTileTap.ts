import { useEffect, useMemo, useRef, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';

import type { TileRect } from './tileRegistry';

/** Сдвиг пальца, после которого касание уже не тап, а начало прокрутки. */
const TAP_SLOP = 10;
/**
 * Столько палец должен пробыть на плитке, чтобы окно просмотра начало
 * готовиться. Прокрутка, начатая с плитки, узнаёт себя раньше — и окно
 * не рождается на каждом движении списка: на release это давало рывок в
 * первом кадре прокрутки (99-й перцентиль кадра 77 мс против 25).
 */
const ARM_DELAY_MS = 40;

export type TileTapHandlers = {
  /** Где плитка сейчас: просмотр вырастает из неё. */
  measure: () => Promise<TileRect | null>;
  onTap: (origin: TileRect | null) => void;
  /** Палец задержался на плитке: пора готовить окно просмотра. */
  onArm?: (origin: TileRect | null) => void;
  /**
   * Тапа не будет (прокрутка, долгое нажатие, плитка ушла из списка): окно
   * больше не нужно.
   */
  onDisarm?: () => void;
  /** Имя жеста для тестов. */
  testID?: string;
};

/**
 * Тап по плитке медиа жест-обработчиком, а не `Pressable`.
 *
 * Список, который едет по инерции или отскакивает от края, забирает касание
 * себе в JS (`ScrollView` считает себя «анимирующимся», пока до JS не дошёл
 * конец инерции — в dev это и полсекунды), и `Pressable` его не получает.
 * Обработчик распознаёт тап на нативной стороне, мимо этой очереди, — тап
 * по медиа на медленном хвосте и на отскоке срабатывает сразу. Быстрый
 * полёт первое касание по-прежнему только останавливает: там касание
 * забирает сам нативный список (см. `modules/scroll-tap`), и тап отменяется.
 *
 * Узнав себя, обработчик отменяет касание строки, так что `onPress`
 * `Pressable` под ним не срабатывает дважды; `Pressable` остаётся ради
 * доступности и зовёт `open`.
 *
 * Замер плитки асинхронный: палец мог уйти раньше, чем она измерилась, —
 * запоздалый взвод оставил бы над экраном невидимое окно. Поэтому каждый
 * взвод помечен, и всё, что случилось после него, метку сбивает.
 */
export function useTileTap({ measure, onTap, onArm, onDisarm, testID }: TileTapHandlers) {
  const [session] = useState(createArmSession);
  const disarmRef = useRef(onDisarm);

  useEffect(() => {
    disarmRef.current = onDisarm;
  }, [onDisarm]);

  // Плитка ушла из списка, пока палец лежал на ней: жест может не успеть
  // сказать «тапа не будет», и взведённое окно осталось бы висеть.
  useEffect(
    () => () => {
      if (session.reset()) disarmRef.current?.();
    },
    [session],
  );

  return useMemo(() => {
    const open = () => {
      session.reset();
      void measure().then(onTap);
    };

    const tap = Gesture.Tap()
      .maxDistance(TAP_SLOP)
      .runOnJS(true)
      .onBegin(() => {
        if (!onArm) return;

        session.schedule(ARM_DELAY_MS, (stillCurrent) => {
          void measure().then((origin) => {
            if (stillCurrent()) onArm(origin);
          });
        });
      })
      .onEnd((_event, success) => {
        if (success) open();
      })
      .onFinalize((_event, success) => {
        if (!success && session.reset()) onDisarm?.();
      });

    return { gesture: testID ? tap.withTestId(testID) : tap, open };
  }, [measure, onArm, onDisarm, onTap, session, testID]);
}

/**
 * Взвод одного касания: таймер и метка. `reset` отменяет таймер, сбивает
 * метку и говорит, был ли взвод начат, — тогда окно нужно убрать.
 */
function createArmSession() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let token = 0;
  let started = false;

  return {
    schedule(delay: number, run: (stillCurrent: () => boolean) => void) {
      if (timer) clearTimeout(timer);
      token += 1;
      started = false;
      const mine = token;

      timer = setTimeout(() => {
        timer = null;
        started = true;
        run(() => token === mine);
      }, delay);
    },
    reset(): boolean {
      if (timer) clearTimeout(timer);
      timer = null;
      token += 1;
      const wasStarted = started;

      started = false;

      return wasStarted;
    },
  };
}
