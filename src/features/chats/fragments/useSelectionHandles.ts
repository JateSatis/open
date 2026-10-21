import { useEffect, useMemo } from 'react';
import { Gesture, type GestureType } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import {
  beginHandleDrag,
  endSelectionDrag,
  handleSpots,
  hitHandle,
  moveSelectionDrag,
  type HandleSpots,
} from '@/features/chats/fragments/fragmentSelection';
import {
  getFragmentState,
  subscribeTextSelection,
  useRowHasSelection,
} from '@/features/chats/fragments/fragmentStore';

const EDGES = ['start', 'end'] as const;

function grab(rowKey: string, edge: 1 | 2, lift: number) {
  beginHandleDrag(rowKey, EDGES[edge - 1], lift);
}

/**
 * Перетаскивание ручек выделения — жест строки, первым в её гонке. Касание на
 * ручке узнаёт себя сразу и забирает палец: свайп-ответ, долгое нажатие и
 * прокрутка списка его уже не получат. Мимо ручки — сразу отказ, и строка
 * живёт как обычно.
 *
 * Решение «ручка или нет» принимается на UI-потоке в момент касания, поэтому
 * положения ручек лежат в shared value и обновляются подпиской на стор, а не
 * перерисовкой строки. Жест один на всё время выделения: пересоздание посреди
 * перетаскивания оборвало бы его.
 *
 * Тянет ручку протяжка (`fragmentSelection`) — по пальцу в окне, а не в
 * строке: у края переписки она прокручивает её сама, и строка уезжает из-под
 * стоящего пальца. Пока ручку держат, охватывающие горизонтальные жесты
 * (свайп страницы) ждут.
 */
export function useSelectionHandles(
  rowKey: string,
  enclosing: readonly GestureType[],
): GestureType {
  const active = useRowHasSelection(rowKey);
  const spots = useSharedValue<HandleSpots | null>(null);
  const grabbed = useSharedValue<0 | 1 | 2>(0);

  useEffect(() => {
    if (!active) {
      spots.set(null);
      return;
    }

    const place = () => {
      const { selection } = getFragmentState();

      spots.set(selection?.rowKey === rowKey ? handleSpots(selection) : null);
    };

    place();

    return subscribeTextSelection(place);
  }, [active, rowKey, spots]);

  // Жест есть у строки всегда, без выделения — выключен: появись он в гонке
  // строки только с выделением, состав гонки сменился бы, и обработчики строки
  // переподключились бы посреди касания — оборвав протяжку, которая это
  // выделение и создала.
  return useMemo(
    () =>
      Gesture.Pan()
        .enabled(active)
        .manualActivation(true)
        .withTestId(`selection-handles-${rowKey}`)
        .onTouchesDown((event, manager) => {
          const at = spots.get();
          const touch = event.allTouches[0];

          if (!at || !touch || event.numberOfTouches > 1) {
            manager.fail();
            return;
          }

          const x = touch.x - at.originX;
          const y = touch.y - at.originY;
          const edge = hitHandle(at, x, y);

          if (edge === 0) {
            manager.fail();
            return;
          }

          // Где палец держит каплю относительно середины строки — чтобы ручка
          // не прыгала под палец.
          const caret = edge === 1 ? at.start : at.end;

          grabbed.set(edge);
          runOnJS(grab)(rowKey, edge, y - (caret.top + caret.bottom) / 2);
          manager.activate();
        })
        .onUpdate((event) => {
          if (grabbed.get() === 0) return;

          runOnJS(moveSelectionDrag)(event.absoluteX, event.absoluteY);
        })
        .onFinalize(() => {
          if (grabbed.get() === 0) return;

          grabbed.set(0);
          runOnJS(endSelectionDrag)('handle');
        })
        .blocksExternalGesture(...enclosing),
    [active, enclosing, grabbed, rowKey, spots],
  );
}
