import { useEffect, useMemo } from 'react';
import { Gesture, type GestureType } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import {
  dragHandle,
  handleSpots,
  hitHandle,
  type HandleSpots,
} from '@/features/chats/fragments/fragmentSelection';
import {
  getFragmentState,
  subscribeTextSelection,
  updateTextSelection,
  useRowHasSelection,
} from '@/features/chats/fragments/fragmentStore';

const EDGES = ['start', 'end'] as const;

function setDragging(edge: 0 | 1 | 2) {
  updateTextSelection({ dragging: edge === 0 ? null : EDGES[edge - 1] });
}

function drag(edge: 1 | 2, x: number, y: number) {
  dragHandle(EDGES[edge - 1], x, y);
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
 */
export function useSelectionHandles(rowKey: string): GestureType | undefined {
  const active = useRowHasSelection(rowKey);
  const spots = useSharedValue<HandleSpots | null>(null);
  const grabbed = useSharedValue<0 | 1 | 2>(0);
  const lift = useSharedValue(0);

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

  return useMemo(() => {
    if (!active) return undefined;

    return Gesture.Pan()
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

        lift.set(y - (caret.top + caret.bottom) / 2);
        grabbed.set(edge);
        runOnJS(setDragging)(edge);
        manager.activate();
      })
      .onUpdate((event) => {
        const edge = grabbed.get();
        const at = spots.get();

        if (edge === 0 || !at) return;

        runOnJS(drag)(edge, event.x - at.originX, event.y - at.originY - lift.get());
      })
      .onFinalize(() => {
        if (grabbed.get() === 0) return;

        grabbed.set(0);
        runOnJS(setDragging)(0);
      });
  }, [active, grabbed, lift, rowKey, spots]);
}
