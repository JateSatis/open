// Мутация `.value` у shared value — штатный API Reanimated, а не нарушение
// чистоты, которое видит в этом React Compiler.
/* eslint-disable react-hooks/immutability */
import { useMemo, type ComponentType, type RefObject } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import { followFinger, startFinger } from './followFinger';
import { OPEN_SPRING } from './geometry';
import { shouldDismissSheet } from './shouldDismissSheet';

/** Жест закрытия — снаружи нужен только тестам, поэтому лежит рядом с самим жестом. */
export const SHEET_PAN_TEST_ID = 'media-picker-pan';

/** Жест считается вертикальным после этого сдвига — иначе тап по кружку не доживал бы до Pressable. */
const PAN_ACTIVATION_PX = 8;

type Params = {
  /** Насколько шит утащен вниз от рабочего положения. */
  dismissY: SharedValue<number>;
  scrollOffset: SharedValue<number>;
  /** Палец сейчас тянет шит, а не список: список держится в нуле. */
  dismissing: SharedValue<boolean>;
  scrollGestureRef: RefObject<ComponentType | null>;
  /**
   * Ссылка на скролл заполнена. RNGH читает её, когда жест подключается, а
   * не при каждом касании: жест, собранный до появления списка, со скроллом
   * не связан и отменял бы его. Поэтому жест пересобирается ровно один раз —
   * когда список смонтирован.
   */
  scrollAttached: boolean;
  dismissDistance: number;
  onRelease: () => void;
};

/**
 * Палец над шитом ведёт одно из двух: список (нативный скролл) или сам шит
 * (`dismissY`). Кто именно — решается не один раз в начале жеста, а в каждом
 * кадре движения:
 *
 * - список упёрся в верх, а палец идёт вниз — дальше едет шит, с того места,
 *   где список остановился;
 * - шит вернулся в рабочее положение, а палец идёт вверх — дальше снова едет
 *   список.
 *
 * Поэтому непрерывное движение пальцем проходит через свёрнутое положение, не
 * задерживаясь, а бросок, отпущенный над списком, останавливается там, где
 * его остановил скролл: смахивание работает только пока палец на экране.
 *
 * Жест не пересоздаётся на каждом рендере: новый объект жеста заставлял
 * `GestureDetector` переподключать обработчики в тот момент, когда шит
 * только открылся и перерисовывается.
 */
export function useDismissGesture({
  dismissY,
  scrollOffset,
  dismissing,
  scrollGestureRef,
  scrollAttached,
  dismissDistance,
  onRelease,
}: Params) {
  const anchor = useSharedValue(0);
  const lastTranslation = useSharedValue(0);

  return useMemo(
    () =>
      Gesture.Pan()
        .withTestId(SHEET_PAN_TEST_ID)
        .activeOffsetY([-PAN_ACTIVATION_PX, PAN_ACTIVATION_PX])
        .simultaneousWithExternalGesture(scrollGestureRef)
        .onStart((event) => {
          const state = startFinger(event.translationY, dismissY.value);

          dismissing.value = state.dismissing;
          anchor.value = state.anchor;
          lastTranslation.value = state.lastTranslation;
        })
        .onUpdate((event) => {
          const step = followFinger(
            {
              dismissing: dismissing.value,
              anchor: anchor.value,
              lastTranslation: lastTranslation.value,
            },
            event.translationY,
            scrollOffset.value,
          );

          dismissing.value = step.dismissing;
          anchor.value = step.anchor;
          lastTranslation.value = step.lastTranslation;

          if (step.dismissY !== null) dismissY.value = step.dismissY;
        })
        .onEnd((event) => {
          if (!dismissing.value) return;

          dismissing.value = false;

          if (shouldDismissSheet(dismissY.value, dismissDistance, event.velocityY)) {
            // Шит остаётся там, где его отпустили: улетит он или вернётся,
            // решает `onRelease` (с выбранными файлами — после вопроса).
            runOnJS(onRelease)();
            return;
          }

          dismissY.value = withSpring(0, OPEN_SPRING);
        }),
    // `scrollAttached` в теле не читается, но пересобрать жест должен именно он.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anchor, dismissDistance, dismissY, dismissing, lastTranslation, onRelease, scrollAttached, scrollGestureRef, scrollOffset],
  );
}
