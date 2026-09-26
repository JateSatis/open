import { Spacing } from '@/theme';

/** Колонок в гриде — столько же, сколько в галерее Telegram на телефоне. */
export const GRID_COLUMNS = 3;

/** Зазор между клетками и от края экрана, в dp — до округления до пикселей. */
const GRID_GAP_DP = Spacing.half;

export type GridGeometry = {
  /** Сторона квадрата. */
  cellSize: number;
  /** Зазор — один и тот же между клетками, между строками и у края. */
  gap: number;
  /** Шаг сетки: квадрат плюс зазор. Одинаков по горизонтали и вертикали. */
  pitch: number;
  /** Левый край квадрата каждой колонки. */
  columnLeft: number[];
  /** Ширина сетки вместе с полями; остаток экрана справа — фон. */
  width: number;
};

/**
 * Геометрия сетки — единственный источник для клеток грида и для скелета
 * под ними.
 *
 * Всё считается в целых физических пикселях и только потом переводится в
 * dp. Иначе края квадратов оказываются на дробных пикселях, и зазор рисуется
 * то в 5, то в 6 пикселей в зависимости от того, куда округлил растеризатор,
 * а скелет и клетки расходятся по фазе на глубине списка.
 *
 * Лишние пиксели ширины, которые не делятся на три колонки, уходят в правое
 * поле: оно фона шита, и на глаз на пиксель шире.
 *
 * @param width ширина экрана в dp
 * @param scale физических пикселей в dp (`PixelRatio.get()`)
 */
export function gridGeometry(width: number, scale: number): GridGeometry {
  const widthPx = Math.round(width * scale);
  const gapPx = Math.max(1, Math.round(GRID_GAP_DP * scale));
  const cellPx = Math.floor((widthPx - gapPx * (GRID_COLUMNS + 1)) / GRID_COLUMNS);
  const pitchPx = cellPx + gapPx;

  return {
    cellSize: cellPx / scale,
    gap: gapPx / scale,
    pitch: pitchPx / scale,
    columnLeft: Array.from({ length: GRID_COLUMNS }, (_, i) => (gapPx + i * pitchPx) / scale),
    width: (GRID_COLUMNS * pitchPx + gapPx) / scale,
  };
}

/** Длина в dp, округлённая до целых физических пикселей. */
export function snapToPixels(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}

/** Сколько строк нужно, чтобы закрыть экран высотой `height` с запасом в строку. */
export function rowsToFill(height: number, pitch: number): number {
  return Math.ceil(height / pitch) + 1;
}
