import type { Box } from '@/features/media/photoEdits/crop';
import { Sizes } from '@/theme';

export const LEFT = 1;
export const RIGHT = 2;
export const TOP = 4;
export const BOTTOM = 8;

/** Где на рамке палец: битовая маска сторон; 0 — не на ручке. */
export function hitEdges(frame: Box, x: number, y: number): number {
  'worklet';
  const hit = Sizes.cropHandleHit;
  const inX = x > frame.x - hit && x < frame.x + frame.width + hit;
  const inY = y > frame.y - hit && y < frame.y + frame.height + hit;

  if (!inX || !inY) return 0;

  let edges = 0;

  if (Math.abs(x - frame.x) < hit) edges |= LEFT;
  else if (Math.abs(x - (frame.x + frame.width)) < hit) edges |= RIGHT;

  if (Math.abs(y - frame.y) < hit) edges |= TOP;
  else if (Math.abs(y - (frame.y + frame.height)) < hit) edges |= BOTTOM;

  return edges;
}

/**
 * Насколько растёт квадратная рамка, когда тянут за `edges` на (dx, dy):
 * за сторону — вдоль неё наружу, за угол — по оси, куда палец ушёл дальше.
 */
export function squareGrowth(edges: number, dx: number, dy: number): number {
  'worklet';
  const horizontal = edges & LEFT ? -dx : edges & RIGHT ? dx : null;
  const vertical = edges & TOP ? -dy : edges & BOTTOM ? dy : null;

  if (horizontal === null) return vertical ?? 0;
  if (vertical === null) return horizontal;

  return Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical;
}

/**
 * Квадратная рамка, выросшая на `growth`: противоположные стороны стоят, а
 * ось, за которую не тянут, растёт от центра в обе стороны. Не меньше `min`
 * и не за рабочим полем.
 */
export function squareFrame(
  start: Box,
  edges: number,
  growth: number,
  area: Box,
  min: number,
): Box {
  'worklet';
  const left = start.x;
  const right = start.x + start.width;
  const top = start.y;
  const bottom = start.y + start.height;
  const centerX = left + start.width / 2;
  const centerY = top + start.height / 2;
  const areaRight = area.x + area.width;
  const areaBottom = area.y + area.height;

  const roomX =
    edges & LEFT
      ? right - area.x
      : edges & RIGHT
        ? areaRight - left
        : 2 * Math.min(centerX - area.x, areaRight - centerX);
  const roomY =
    edges & TOP
      ? bottom - area.y
      : edges & BOTTOM
        ? areaBottom - top
        : 2 * Math.min(centerY - area.y, areaBottom - centerY);
  const side = Math.min(Math.max(min, start.width + growth), roomX, roomY);

  return {
    x: edges & LEFT ? right - side : edges & RIGHT ? left : centerX - side / 2,
    y: edges & TOP ? bottom - side : edges & BOTTOM ? top : centerY - side / 2,
    width: side,
    height: side,
  };
}

/** Рамка со сдвинутыми сторонами — не меньше `min` и не за рабочим полем. */
export function movedFrame(
  start: Box,
  edges: number,
  dx: number,
  dy: number,
  area: Box,
  min: number,
): Box {
  'worklet';
  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;

  if (edges & LEFT) left = Math.min(Math.max(area.x, left + dx), right - min);
  if (edges & RIGHT) right = Math.max(Math.min(area.x + area.width, right + dx), left + min);
  if (edges & TOP) top = Math.min(Math.max(area.y, top + dy), bottom - min);
  if (edges & BOTTOM) bottom = Math.max(Math.min(area.y + area.height, bottom + dy), top + min);

  return { x: left, y: top, width: right - left, height: bottom - top };
}
