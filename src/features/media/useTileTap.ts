import { useMemo, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';

/** Сдвиг пальца, после которого касание уже не тап, а начало прокрутки. */
const TAP_SLOP = 10;
/**
 * Столько палец должен пробыть на плитке, чтобы окно просмотра начало
 * готовиться. Прокрутка, начатая с плитки, узнаёт себя раньше — и окно
 * не рождается и не умирает на каждом движении списка.
 */
const ARM_DELAY_MS = 40;

export type TileTapHandlers = {
  onTap: () => void;
  /** Палец задержался на плитке: пора готовить окно просмотра. */
  onArm?: () => void;
  /** Тапа не будет (прокрутка, долгое нажатие): окно больше не нужно. */
  onDisarm?: () => void;
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
 * доступности.
 */
export function useTileTap({ onTap, onArm, onDisarm }: TileTapHandlers) {
  const [armTimer] = useState(createTimer);

  return useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(TAP_SLOP)
        .runOnJS(true)
        .onBegin(() => {
          if (onArm) armTimer.start(onArm, ARM_DELAY_MS);
        })
        .onEnd((_event, success) => {
          if (success) {
            armTimer.cancel();
            onTap();
          }
        })
        .onFinalize((_event, success) => {
          armTimer.cancel();
          if (!success) onDisarm?.();
        }),
    [armTimer, onArm, onDisarm, onTap],
  );
}

function createTimer() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return {
    start(run: () => void, delay: number) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delay);
    },
    cancel,
  };
}
