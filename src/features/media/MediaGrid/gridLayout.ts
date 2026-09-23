import { Spacing } from '@/theme';

/** Колонок в гриде — столько же, сколько в галерее Telegram на телефоне. */
export const GRID_COLUMNS = 3;

/**
 * Зазор между клетками и от края экрана. Раскладывается пополам: половина
 * лежит в отступе содержимого списка, половина — внутри самой клетки. Так
 * зазор получается одинаковым и между клетками, и у края, а ширина колонки
 * остаётся ровно третью экрана — это важно для `FlashList`, который делит
 * ширину на колонки сам и не знает ни про какие `columnWrapperStyle`.
 */
export const GRID_GAP = Spacing.half;

/** Отступ внутри клетки — половина зазора, вторая половина у соседа. */
export const GRID_CELL_PADDING = GRID_GAP / 2;

export type GridGeometry = {
  /** Сторона видимого квадрата — столько же, сколько было при вёрстке строками. */
  cellSize: number;
  /** Шаг сетки по вертикали: квадрат плюс зазор. */
  rowHeight: number;
};

/**
 * Геометрия сетки от ширины экрана.
 *
 * Вынесена из компонента и покрыта тестом не ради чистоты: скелет и настоящие
 * клетки обязаны стоять по одной и той же сетке. Разъедься они хоть на
 * пиксель — и в момент подмены скелета фотографиями всё видимо дёрнется.
 */
export function gridGeometry(width: number): GridGeometry {
  const cellSize = (width - GRID_GAP * (GRID_COLUMNS + 1)) / GRID_COLUMNS;

  return { cellSize, rowHeight: cellSize + GRID_GAP };
}

/** Сколько клеток нужно, чтобы закрыть экран высотой `height` с запасом в ряд. */
export function cellsToFill(height: number, rowHeight: number): number {
  return (Math.ceil(height / rowHeight) + 1) * GRID_COLUMNS;
}
