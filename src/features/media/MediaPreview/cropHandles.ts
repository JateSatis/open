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
