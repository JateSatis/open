// Геометрия выделения над снимком отрисованного текста (`modules/text-geometry`):
// куда попал палец и какими прямоугольниками закрасить диапазон. Всё — в
// координатах вью текста, смещения — UTF-16.

import type { TextGeometry, TextLine } from '../../../../modules/text-geometry';

export type Rect = { x: number; y: number; width: number; height: number };

/** Насколько можно промахнуться мимо глифов строки по горизонтали. */
const SIDE_SLOP = 8;

/** Строка, где лежит символ с этим смещением; конец текста — последняя. */
export function lineOfOffset(geometry: TextGeometry, offset: number): number {
  const { lines } = geometry;

  for (let i = 0; i < lines.length; i++) {
    if (offset < lines[i].end) return i;
  }

  return lines.length - 1;
}

function lineAtY(lines: TextLine[], y: number, clamp: boolean): number {
  if (lines.length === 0) return -1;

  if (y < lines[0].top) return clamp ? 0 : -1;

  for (let i = 0; i < lines.length; i++) {
    if (y < lines[i].bottom) return i;
  }

  return clamp ? lines.length - 1 : -1;
}

/** Левый край смещения на строке; конец строки — её правый край. */
function edgeX(geometry: TextGeometry, line: TextLine, offset: number): number {
  if (offset < line.end && offset >= line.start) return geometry.xs[offset] ?? line.left;

  return Math.max(line.right, offset > line.start ? (geometry.xs[offset - 1] ?? line.left) : line.left);
}

/**
 * Смещение под точкой — граница между символами, ближайшая к пальцу.
 * `clamp` — для ручки: палец выше текста — его начало, ниже — конец, сбоку —
 * край строки. Без `clamp` точка мимо текста — `null`.
 */
export function offsetAt(
  geometry: TextGeometry,
  x: number,
  y: number,
  clamp = false,
): number | null {
  const { lines } = geometry;
  const index = lineAtY(lines, y, clamp);

  if (index < 0) return null;

  if (clamp && y < lines[0].top) return lines[0].start;
  if (clamp && y >= lines[lines.length - 1].bottom) return lines[lines.length - 1].end;

  const line = lines[index];

  if (!clamp && (x < line.left - SIDE_SLOP || x > line.right + SIDE_SLOP)) return null;

  // Перенос — граница строки: конец строки и начало следующей — одно смещение,
  // и правый край строки принадлежит ей, а не следующей.
  const last = index === lines.length - 1 ? line.end : Math.max(line.start, line.end - 1);
  let best = line.start;
  let bestDistance = Infinity;

  for (let offset = line.start; offset <= last; offset++) {
    const distance = Math.abs(edgeX(geometry, line, offset) - x);

    if (distance < bestDistance) {
      best = offset;
      bestDistance = distance;
    }
  }

  return best;
}

/** Символ под точкой — сам палец на глифе, а не граница. `null` — мимо текста. */
export function charAt(geometry: TextGeometry, x: number, y: number): number | null {
  const { lines } = geometry;
  const index = lineAtY(lines, y, false);

  if (index < 0) return null;

  const line = lines[index];

  if (x < line.left - SIDE_SLOP || x > line.right + SIDE_SLOP) return null;

  let found = line.start;

  for (let offset = line.start; offset < line.end; offset++) {
    if ((geometry.xs[offset] ?? 0) <= x) found = offset;
  }

  return found;
}

/**
 * Прямоугольники диапазона — по строке на каждую строку, которую он задевает,
 * от первого глифа до последнего на ней: без хвостов строк и межстрочья.
 */
export function rangeRects(geometry: TextGeometry, start: number, end: number): Rect[] {
  if (end <= start) return [];

  const rects: Rect[] = [];

  for (const line of geometry.lines) {
    const from = Math.max(start, line.start);
    const to = Math.min(end, line.end);

    if (to <= from) continue;

    const left = edgeX(geometry, line, from);
    const right = to < line.end ? edgeX(geometry, line, to) : Math.min(line.right, geometry.width);

    if (right - left <= 0) continue;

    rects.push({ x: left, y: line.top, width: right - left, height: line.bottom - line.top });
  }

  return rects;
}

/**
 * Где стоит ручка: у начала — левый край первого символа, у конца — правый
 * край последнего. Высота — строка этого символа.
 */
export function caretAt(
  geometry: TextGeometry,
  offset: number,
  edge: 'start' | 'end',
): { x: number; top: number; bottom: number } {
  const index = lineOfOffset(geometry, edge === 'end' ? Math.max(0, offset - 1) : offset);
  const line = geometry.lines[index];

  if (!line) return { x: 0, top: 0, bottom: 0 };

  const x =
    edge === 'start' || offset < line.end
      ? edgeX(geometry, line, offset)
      : Math.min(line.right, geometry.width);

  return { x, top: line.top, bottom: line.bottom };
}

/** Рамка всего диапазона — для меню над или под выделением. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;

  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
}
