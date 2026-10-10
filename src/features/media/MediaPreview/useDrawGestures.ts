// Жесты на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться.
/* eslint-disable react-hooks/immutability */
import { useMemo } from 'react';
import { Gesture, type GestureTouchEvent, type TouchData } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { drawGeometry, pinchZoom, screenToUnits, type PinchStart } from './drawGeometry';
import type { Rect } from './previewStore';
import type { DrawToolState } from './useDrawTool';

import type { PhotoCrop } from '@/features/media/photoEdits/crop';

/** Точки штриха не чаще, чем через столько точек экрана: меньше — только шум. */
const MIN_STEP = 1.5;
/**
 * Касание фото при открытой панели цвета закрывает её. Палец сдвинулся
 * дальше этого — это уже штрих, он рисуется от места касания; нет — был тап,
 * штриха нет.
 */
const DISMISS_SLOP = 10;

type Mode = 'none' | 'draw' | 'zoom';

function remaining(event: GestureTouchEvent): TouchData[] {
  'worklet';
  return event.allTouches.filter(
    (touch) => !event.changedTouches.some((changed) => changed.id === touch.id),
  );
}

/**
 * Касания рисования на одном слое. Один палец рисует штрих — сразу, без
 * порога, чтобы линия шла от места касания. Второй палец во время штриха
 * отменяет этот штрих и превращает жест в увеличение: щипок и сдвиг двумя
 * пальцами, пока не отпущены все. Ручной жест — потому что решать надо по
 * числу пальцев в каждый момент, а не по готовым распознавателям.
 */
export function useDrawGestures(
  tool: DrawToolState,
  crop: PhotoCrop | null,
  screen: SharedValue<Rect>,
  area: SharedValue<Rect>,
) {
  const mode = useSharedValue<Mode>('none');
  const pinch = useSharedValue<PinchStart | null>(null);
  /** Касание закрыло панель цвета и ещё не стало штрихом: где опустился палец. */
  const dismiss = useSharedValue<{ x: number; y: number } | null>(null);
  const { colorsOpen, close: closePicker } = tool.picker;
  const { size, strokeId, finishStroke, open, selectedBrush, selectedColor, progress } = tool;
  // Ворклеты берут shared values по одному, а не объект с картинкой.
  const { points, width, brush, color } = tool.live;
  const { scale, x, y } = tool.live.zoom;

  return useMemo(() => {
    const geometry = () => {
      'worklet';
      // `crop` есть: жест включён, только пока открыто рисование.
      return drawGeometry(
        crop as PhotoCrop,
        screen.value,
        area.value,
        {
          scale: scale.value,
          x: x.value,
          y: y.value,
        },
        progress.value,
      );
    };

    const startPinch = (touches: TouchData[]) => {
      'worklet';
      const [a, b] = touches;

      pinch.value = {
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        scale: scale.value,
        x: x.value,
        y: y.value,
      };
    };

    return Gesture.Manual()
      .enabled(open && crop !== null)
      .shouldCancelWhenOutside(false)
      .onTouchesDown((event, manager) => {
        manager.activate();

        const touches = event.allTouches;

        if (touches.length >= 2) {
          // Второй палец: штрих, начатый первым, не остаётся.
          if (mode.value === 'draw') points.value = [];
          dismiss.value = null;
          mode.value = 'zoom';
          startPinch(touches);
          return;
        }

        if (mode.value !== 'none') return;

        const g = geometry();
        const point = screenToUnits(g, touches[0].x, touches[0].y);

        mode.value = 'draw';
        strokeId.value += 1;
        brush.value = selectedBrush.value;
        color.value = selectedColor.value;
        width.value = size.value / g.pointsPerUnit;

        if (colorsOpen.value) {
          // Точек пока нет: тап не оставит даже точки.
          colorsOpen.value = false;
          dismiss.value = { x: touches[0].x, y: touches[0].y };
          points.value = [];
          runOnJS(closePicker)();
          return;
        }

        dismiss.value = null;
        points.value = [point.x, point.y];
      })
      .onTouchesMove((event) => {
        const touches = event.allTouches;

        if (mode.value === 'zoom') {
          const start = pinch.value;

          if (touches.length < 2 || !start) return;

          const next = pinchZoom(geometry(), start, touches[0], touches[1]);

          scale.value = next.scale;
          x.value = next.x;
          y.value = next.y;
          return;
        }

        if (mode.value !== 'draw') return;

        const g = geometry();
        const touch = touches[0];
        const point = screenToUnits(g, touch.x, touch.y);
        const step = MIN_STEP / g.pointsPerUnit;
        const down = dismiss.value;

        if (down) {
          if (Math.hypot(touch.x - down.x, touch.y - down.y) < DISMISS_SLOP) return;

          // Повели пальцем — штрих, от места касания.
          const from = screenToUnits(g, down.x, down.y);

          dismiss.value = null;
          points.value = [from.x, from.y, point.x, point.y];
          return;
        }

        points.modify((list) => {
          'worklet';
          const lastX = list[list.length - 2];
          const lastY = list[list.length - 1];

          if (Math.hypot(point.x - lastX, point.y - lastY) >= step) list.push(point.x, point.y);

          return list;
        });
      })
      .onTouchesUp((event, manager) => {
        const left = remaining(event);

        if (mode.value === 'draw' && left.length === 0 && dismiss.value) {
          dismiss.value = null;
        } else if (mode.value === 'draw' && left.length === 0) {
          const pointsNow = points.value.slice();

          runOnJS(finishStroke)(strokeId.value, pointsNow, brush.value, color.value, width.value);
        }

        if (left.length >= 2) startPinch(left);
        else pinch.value = null;

        if (left.length === 0) {
          mode.value = 'none';
          manager.end();
        }
      })
      .onTouchesCancelled((_event, manager) => {
        if (mode.value === 'draw') points.value = [];
        dismiss.value = null;
        mode.value = 'none';
        pinch.value = null;
        manager.end();
      });
  }, [
    area,
    brush,
    closePicker,
    color,
    colorsOpen,
    crop,
    dismiss,
    finishStroke,
    mode,
    open,
    pinch,
    points,
    progress,
    scale,
    screen,
    selectedBrush,
    selectedColor,
    size,
    strokeId,
    width,
    x,
    y,
  ]);
}
