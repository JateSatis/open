import { Sizes } from '@/theme';

/**
 * Ползунок толщины рисования — клин: сверху широкий, снизу узкий. Бегунок —
 * кружок диаметром в текущую толщину, и он всегда целиком внутри клина:
 * центр бегунка ходит от низа до верха так, что кружок касается боков
 * клина, а не вылезает за них. Отсюда и пределы толщины.
 */
const HEIGHT = Sizes.drawSliderHeight;
const NARROW = Sizes.drawSliderNarrow;
const WIDE = Sizes.drawSliderWide;
/** Насколько клин сужается на точку высоты. */
const SLOPE = (WIDE - NARROW) / HEIGHT;
/**
 * Крайние центры бегунка: кружок толщиной в ширину клина касается низа
 * (верха) клина. Из `c ± wedgeWidth(c) / 2 = край`.
 */
const LOWEST = (HEIGHT - NARROW / 2 - (SLOPE * HEIGHT) / 2) / (1 - SLOPE / 2);
const HIGHEST = WIDE / 2 / (1 + SLOPE / 2);

/** Ширина клина на высоте `y` от его верха. */
function wedgeWidth(y: number): number {
  'worklet';
  return NARROW + SLOPE * (HEIGHT - y);
}

export function sizeRange(): { min: number; max: number } {
  return { min: wedgeWidth(LOWEST), max: wedgeWidth(HIGHEST) };
}

/** Центр бегунка по вертикали для этой толщины — там клин как раз этой ширины. */
export function thumbCenter(size: number): number {
  'worklet';
  const min = wedgeWidth(LOWEST);
  const max = wedgeWidth(HIGHEST);
  const value = Math.min(max, Math.max(min, size));

  return LOWEST - ((value - min) / (max - min)) * (LOWEST - HIGHEST);
}

/** Толщина при сдвиге пальца на `dy` точек от толщины `start`: вверх — толще. */
export function dragSize(start: number, dy: number): number {
  'worklet';
  const min = wedgeWidth(LOWEST);
  const max = wedgeWidth(HIGHEST);
  const perPoint = (max - min) / (LOWEST - HIGHEST);

  return Math.min(max, Math.max(min, start - dy * perPoint));
}
