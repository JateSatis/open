// Жесты на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться.
/* eslint-disable react-hooks/immutability */
import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import {
  boxCenter,
  currentCrop,
  fittedFrame,
  isRecentering,
  NO_TWIST,
  recenteringFrame,
  type CropMotion,
} from './cropMotion';
import { hitEdges, movedFrame, squareFrame, squareGrowth } from './cropHandles';
import { startCropTransition } from './useCropTool';

import { rubberBand } from '@/features/media/MediaViewer/viewerMath';
import {
  clampCenter,
  coverCrop,
  fitZoom,
  isCovered,
  minCropSide,
  minCropWidth,
  resizeCrop,
  screenToSourceDelta,
  type Box,
  type PhotoCrop,
} from '@/features/media/photoEdits/crop';
import { Sizes } from '@/theme';

/** Отпустили рамку — она с фото встаёт по центру не сразу, а через миг. */
export const RECENTER_DELAY_MS = 350;
export const RECENTER_MS = 320;
const SPRING_BACK_MS = 260;
export const GRID_FADE_MS = 200;
/** Щипком за предел увеличения — туго, пружина вернёт. */
const PINCH_RUBBER = 0.3;
/** Столько шагов поиска упора: рамка не залезает за фото с точностью до долей точки. */
const FIT_STEPS = 12;

type Mode = 'none' | 'image' | 'frame';

/**
 * Переход, если он ещё идёт, останавливается там, где он сейчас на экране:
 * догорающий сдвиг рамки к центру превращается в рамку, которую держат
 * пальцем, без скачка. Разворот на 90° и отражение доигрываются мгновенно.
 */
export function settleCrop(m: CropMotion) {
  'worklet';

  if (m.t.value >= 1) return;

  const now = currentCrop(m);

  if (isRecentering(m)) m.frame.value = recenteringFrame(m, fittedFrame(now, m.area.value));

  cancelAnimation(m.t);

  m.crop.value = now;
  m.from.value = now;
  m.twist.value = NO_TWIST;
  m.t.value = 1;
}

/** Центр с резиной за краем: тянуть можно, но всё туже. */
function rubberCenter(crop: PhotoCrop): PhotoCrop {
  'worklet';
  const clamped = clampCenter(crop);

  return {
    ...crop,
    centerX: clamped.centerX + rubberBand(crop.centerX - clamped.centerX, crop.width),
    centerY: clamped.centerY + rubberBand(crop.centerY - clamped.centerY, crop.height),
  };
}

/**
 * Жесты рамки обрезки на одном слое, чтобы они не крали касания друг у
 * друга: куда попал палец, решается в момент касания. Угол или сторона —
 * тянется рамка, фото стоит; внутри и снаружи — двигается фото; два пальца —
 * щипок фото с центром между ними. Линейка — отдельный жест в своей панели.
 */
export function useCropGestures(m: CropMotion, rotationBase: SharedValue<PhotoCrop | null>) {
  const mode = useSharedValue<Mode>('none');
  const edges = useSharedValue(0);
  const startCrop = useSharedValue<PhotoCrop | null>(null);
  const startFrame = useSharedValue<Box>({ x: 0, y: 0, width: 1, height: 1 });
  const focal = useSharedValue({ x: 0, y: 0 });
  const active = useSharedValue(0);

  return useMemo(() => {
    /** Снимок на начало жеста: рамка зафиксирована, масштаб известен. */
    const anchor = () => {
      'worklet';
      settleCrop(m);
      rotationBase.value = null;

      const crop = m.crop.value;
      const frame = m.frame.value ?? fittedFrame(crop, m.area.value);

      m.frame.value = frame;
      startCrop.value = crop;
      startFrame.value = frame;
    };

    const release = () => {
      'worklet';
      active.value = Math.max(0, active.value - 1);

      if (active.value > 0) return;

      const wasFrame = mode.value === 'frame';

      mode.value = 'none';
      m.grid.value = withTiming(0, { duration: GRID_FADE_MS });

      if (m.frame.value === null) return;

      if (wasFrame) {
        // Рамка с фото доцентровываются и встают на рабочее поле.
        startCropTransition(m, m.crop.value, {
          cover: true,
          duration: RECENTER_MS,
          delay: RECENTER_DELAY_MS,
        });
        return;
      }

      // Фото вытащили за край или ужали меньше рамки — пружинит обратно.
      const target = coverCrop(m.crop.value);

      startCropTransition(m, target, { cover: false, duration: SPRING_BACK_MS });
    };

    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(0)
      .onBegin((event) => {
        active.value += 1;
        anchor();

        const hit = hitEdges(startFrame.value, event.x, event.y);

        edges.value = hit;
        mode.value = hit ? 'frame' : 'image';
        if (hit) m.grid.value = withTiming(1, { duration: GRID_FADE_MS });
      })
      .onUpdate((event) => {
        const start = startCrop.value;

        if (!start) return;

        const frame = startFrame.value;
        const scale = frame.width / start.width;

        if (mode.value === 'image') {
          const shift = screenToSourceDelta(start, event.translationX, event.translationY, scale);

          m.crop.value = rubberCenter({
            ...start,
            centerX: start.centerX - shift.x,
            centerY: start.centerY - shift.y,
          });
          return;
        }

        if (mode.value !== 'frame') return;

        // Сильнее фото не увеличить: рамка не уже самой малой обрезки.
        const min = Math.max(Sizes.cropMinFrame, minCropSide(start) * scale);
        const area = m.area.value;

        if (m.square) {
          // Квадрат растёт одним числом — упор ищется по нему же.
          const want = squareGrowth(edges.value, event.translationX, event.translationY);
          const fitsSquare = (growth: number) =>
            isCovered(
              resizeCrop(start, frame, squareFrame(frame, edges.value, growth, area, min), scale),
            );
          let growth = want;

          if (!fitsSquare(want)) {
            let low = 0;
            let high = 1;

            for (let step = 0; step < FIT_STEPS; step += 1) {
              const mid = (low + high) / 2;

              if (fitsSquare(want * mid)) low = mid;
              else high = mid;
            }

            growth = want * low;
          }

          const box = squareFrame(frame, edges.value, growth, area, min);

          m.frame.value = box;
          m.crop.value = resizeCrop(start, frame, box, scale);
          return;
        }

        const fits = (dx: number, dy: number) => {
          const box = movedFrame(frame, edges.value, dx, dy, area, min);

          return isCovered(resizeCrop(start, frame, box, scale));
        };
        // Упор по каждой оси отдельно: упёрлись сбоку — вверх-вниз тянется дальше.
        const reach = (want: number, other: number, horizontal: boolean) => {
          if (horizontal ? fits(want, other) : fits(other, want)) return want;

          let low = 0;
          let high = 1;

          for (let step = 0; step < FIT_STEPS; step += 1) {
            const mid = (low + high) / 2;
            const ok = horizontal ? fits(want * mid, other) : fits(other, want * mid);

            if (ok) low = mid;
            else high = mid;
          }

          return want * low;
        };
        const dx = reach(event.translationX, 0, true);
        const dy = reach(event.translationY, dx, false);
        const box = movedFrame(frame, edges.value, dx, dy, area, min);

        m.frame.value = box;
        m.crop.value = resizeCrop(start, frame, box, scale);
      })
      .onFinalize(release);

    const pinch = Gesture.Pinch()
      .onBegin(() => {
        active.value += 1;
      })
      // Начало щипка — второй палец, а не первое касание: одиночное касание
      // ручки рамки щипок перехватывать не должен.
      .onStart((event) => {
        anchor();
        mode.value = 'image';
        focal.value = { x: event.focalX, y: event.focalY };
      })
      .onUpdate((event) => {
        const start = startCrop.value;

        if (!start || mode.value !== 'image') return;

        const frame = startFrame.value;
        const center = boxCenter(frame);
        const scale = frame.width / start.width;
        // Точка фото под пальцами на начало щипка — она и остаётся под ними.
        const offset = screenToSourceDelta(
          start,
          focal.value.x - center.x,
          focal.value.y - center.y,
          scale,
        );
        const pinned = { x: start.centerX + offset.x, y: start.centerY + offset.y };

        // Меньше рамки фото не ужать: дальше — туго.
        const coverable = start.width / fitZoom(start);
        const tightest = minCropWidth(start);
        let width = start.width / event.scale;

        if (width > coverable) width = coverable * Math.pow(width / coverable, PINCH_RUBBER);
        width = Math.max(width, tightest);

        const height = (width * start.height) / start.width;
        const nextScale = frame.width / width;
        const sized = { ...start, width, height };
        const back = screenToSourceDelta(
          sized,
          event.focalX - center.x,
          event.focalY - center.y,
          nextScale,
        );

        m.crop.value = rubberCenter({
          ...sized,
          centerX: pinned.x - back.x,
          centerY: pinned.y - back.y,
        });
      })
      .onFinalize(release);

    return Gesture.Simultaneous(pan, pinch);
  }, [active, edges, focal, m, mode, rotationBase, startCrop, startFrame]);
}
