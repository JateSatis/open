import { MAX_FINE_ANGLE } from '@/features/media/photoEdits/crop';
import { Sizes } from '@/theme';

/** Ближе этого к нулю угол прилипает к нулю — ровно поставить легко. */
const ZERO_SNAP = 0.3;

/**
 * Угол по линейке: сдвиг пальца на `cropRulerStep` точек — градус, в
 * пределах ±45°, у нуля прилипает. Проход через ноль — лёгкая вибрация.
 */
export function rulerAngle(startAngle: number, translationX: number): number {
  'worklet';
  const raw = startAngle - translationX / Sizes.cropRulerStep;
  const clamped = Math.max(-MAX_FINE_ANGLE, Math.min(MAX_FINE_ANGLE, raw));

  return Math.abs(clamped) < ZERO_SNAP ? 0 : clamped;
}

/** «-7.6°», ноль — «0°». */
export function formatAngle(angle: number): string {
  'worklet';
  const rounded = Math.round(angle * 10) / 10;

  return rounded === 0 ? '0°' : `${rounded.toFixed(1)}°`;
}

/** Прошли через ноль или пришли в него — отметить вибрацией. */
export function crossesZero(previous: number, next: number): boolean {
  'worklet';
  return (next === 0 && previous !== 0) || next * previous < 0;
}
