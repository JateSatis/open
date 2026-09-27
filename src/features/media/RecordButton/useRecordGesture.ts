// Мутация `.value` у shared value — штатный API Reanimated, а не нарушение
// чистоты, которое видит в этом React Compiler.
/* eslint-disable react-hooks/immutability */
import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import { CANCEL_DISTANCE, LOCK_DISTANCE } from './styles';

export type RecordGestureAction =
  'pressIn' | 'release' | 'slideCancel' | 'lock' | 'sendLocked' | 'systemCancel';

/**
 * Куда ушёл палец: влево за порог — отмена, вверх за порог — замок. Отмена
 * проверяется первой: если палец ушёл по диагонали дальше обоих порогов,
 * человек скорее хотел выбросить запись, чем закрепить её.
 */
export function crossedThreshold(dx: number, dy: number): 'cancel' | 'lock' | null {
  'worklet';

  if (-dx >= CANCEL_DISTANCE) return 'cancel';
  if (-dy >= LOCK_DISTANCE) return 'lock';

  return null;
}

type Params = {
  drag: { x: SharedValue<number>; y: SharedValue<number> };
  /** Запись закреплена: следующее касание кнопки — «отправить». */
  locked: SharedValue<boolean>;
  onAction: (action: RecordGestureAction) => void;
};

/**
 * Жест кнопки записи. Ручной (`Gesture.Manual`), а не нажатие: нужны и
 * касание, и путь пальца, и отпускание, и отдельно — отмена жеста системой,
 * которую нажатие не отличает от отпускания. Путь пальца считается на
 * UI-потоке, в JS уходят только события.
 *
 * Жест собирается один раз: `onAction` должен быть стабильным.
 */
export function useRecordGesture({ drag, locked, onAction }: Params) {
  const startedLocked = useSharedValue(false);
  /** Это касание уже ушло за порог — дальше путь пальца ничего не решает. */
  const crossed = useSharedValue(false);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);

  return useMemo(
    () =>
      Gesture.Manual()
        .shouldCancelWhenOutside(false)
        .onTouchesDown((event, manager) => {
          const touch = event.changedTouches[0];

          if (!touch || event.numberOfTouches > 1) return;

          manager.activate();
          originX.value = touch.absoluteX;
          originY.value = touch.absoluteY;
          drag.x.value = 0;
          drag.y.value = 0;
          crossed.value = false;
          startedLocked.value = locked.value;

          if (!startedLocked.value) runOnJS(onAction)('pressIn');
        })
        .onTouchesMove((event) => {
          const touch = event.changedTouches[0];

          if (!touch || startedLocked.value || crossed.value) return;

          const dx = Math.min(0, touch.absoluteX - originX.value);
          const dy = Math.min(0, touch.absoluteY - originY.value);
          const threshold = crossedThreshold(dx, dy);

          drag.x.value = dx;
          drag.y.value = dy;

          if (threshold === 'cancel') {
            crossed.value = true;
            runOnJS(onAction)('slideCancel');
          } else if (threshold === 'lock') {
            crossed.value = true;
            runOnJS(onAction)('lock');
          }
        })
        .onTouchesUp((event, manager) => {
          if (event.numberOfTouches > 0) return;

          manager.end();

          if (startedLocked.value) {
            runOnJS(onAction)('sendLocked');
          } else if (!crossed.value) {
            runOnJS(onAction)('release');
          }

          drag.x.value = withSpring(0);
          drag.y.value = withSpring(0);
        })
        .onTouchesCancelled((_event, manager) => {
          manager.fail();

          if (!startedLocked.value && !crossed.value) runOnJS(onAction)('systemCancel');

          drag.x.value = withSpring(0);
          drag.y.value = withSpring(0);
        }),
    [crossed, drag, locked, onAction, originX, originY, startedLocked],
  );
}
