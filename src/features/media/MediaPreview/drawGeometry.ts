import { fitRect } from './previewGeometry';
import type { Rect } from './previewStore';

import {
  applyAffine,
  cropAspect,
  cropTransform,
  invertAffine,
  type Affine,
  type PhotoCrop,
} from '@/features/media/photoEdits/crop';

/** Сильнее увеличить в рисовании нельзя. */
export const MAX_DRAW_ZOOM = 8;

export type ZoomState = { scale: number; x: number; y: number };

/**
 * Где фото в рисовании и как экран переводится в единицы рисунка.
 *
 * Страница рисует фото на холсте размером `base` — фото, вписанное в весь
 * экран, — и ужимает его трансформом в рабочую область (`frame`).
 * Увеличение — внутри холста: `canvas = scale · p + (x, y)`.
 */
export type DrawGeometry = {
  frame: Rect;
  base: Rect;
  zoom: ZoomState;
  /** Единицы рисунка → холст без увеличения. */
  unitsToCanvas: Affine;
  /** Точек экрана на единицу рисунка — при этом увеличении. */
  pointsPerUnit: number;
};

export function drawGeometry(
  crop: PhotoCrop,
  screen: Rect,
  area: Rect,
  zoom: ZoomState,
): DrawGeometry {
  'worklet';
  const aspect = cropAspect(crop);
  const frame = fitRect(aspect, area);
  const base = fitRect(aspect, { x: 0, y: 0, width: screen.width, height: screen.height });

  return {
    frame,
    base,
    zoom,
    unitsToCanvas: cropTransform(crop, { x: 0, y: 0, width: base.width, height: base.height }, 1),
    pointsPerUnit: (frame.width * zoom.scale) / crop.width,
  };
}

/** Точка экрана → холст страницы (до увеличения). */
function screenToCanvas(g: DrawGeometry, x: number, y: number): { x: number; y: number } {
  'worklet';
  const k = g.base.width / g.frame.width;

  return { x: (x - g.frame.x) * k, y: (y - g.frame.y) * k };
}

/** Точка экрана → единицы рисунка: сквозь ужатие, увеличение и обрезку. */
export function screenToUnits(g: DrawGeometry, x: number, y: number): { x: number; y: number } {
  'worklet';
  const canvas = screenToCanvas(g, x, y);
  const plain = {
    x: (canvas.x - g.zoom.x) / g.zoom.scale,
    y: (canvas.y - g.zoom.y) / g.zoom.scale,
  };

  return applyAffine(invertAffine(g.unitsToCanvas), plain.x, plain.y);
}

/** Начало щипка: где были пальцы (точки экрана) и какое было увеличение. */
export type PinchStart = ZoomState & { ax: number; ay: number; bx: number; by: number };

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

/**
 * Щипок и сдвиг двумя пальцами: точка фото, что была между пальцами,
 * остаётся между ними. Мельче исходного не уменьшить, и фото не отъезжает
 * от краёв рабочей области — за ними пусто.
 */
export function pinchZoom(
  g: DrawGeometry,
  start: PinchStart,
  a: { x: number; y: number },
  b: { x: number; y: number },
): ZoomState {
  'worklet';
  const a0 = screenToCanvas(g, start.ax, start.ay);
  const b0 = screenToCanvas(g, start.bx, start.by);
  const a1 = screenToCanvas(g, a.x, a.y);
  const b1 = screenToCanvas(g, b.x, b.y);
  const before = Math.max(1, Math.hypot(b0.x - a0.x, b0.y - a0.y));
  const after = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const scale = clamp((start.scale * after) / before, 1, MAX_DRAW_ZOOM);
  // Точка холста без увеличения, бывшая между пальцами.
  const focusX = ((a0.x + b0.x) / 2 - start.x) / start.scale;
  const focusY = ((a0.y + b0.y) / 2 - start.y) / start.scale;
  const x = (a1.x + b1.x) / 2 - scale * focusX;
  const y = (a1.y + b1.y) / 2 - scale * focusY;

  return {
    scale,
    x: clamp(x, g.base.width * (1 - scale), 0),
    y: clamp(y, g.base.height * (1 - scale), 0),
  };
}
