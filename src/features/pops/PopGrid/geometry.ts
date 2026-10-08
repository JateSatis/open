import type { Pop } from '@/api/pops';
import type { PendingPop } from '@/features/pops/publishing';
import { Sizes } from '@/theme';

/** Колонок в сетке попсов — как в профиле TikTok. */
export const POP_COLUMNS = 3;

export type PopGridGeometry = {
  cellWidth: number;
  cellHeight: number;
  /** Шаг строки: высота плитки плюс зазор. */
  rowPitch: number;
  /** Левый край плитки каждой колонки. */
  columnLeft: number[];
};

/**
 * Плитки 9:16 без полей у края, с тонким зазором между собой. Считается в
 * целых физических пикселях, как сетка галереи (`gridLayout.ts`): края плиток
 * не попадают на полпикселя, и зазор везде одной толщины. Остаток ширины,
 * не делящийся на три, уходит в последнюю колонку.
 */
export function popGridGeometry(width: number, scale: number): PopGridGeometry {
  const widthPx = Math.round(width * scale);
  const gapPx = Math.max(1, Math.round(Sizes.popGridGap * scale));
  const cellPx = Math.floor((widthPx - gapPx * (POP_COLUMNS - 1)) / POP_COLUMNS);
  const heightPx = Math.round(cellPx / Sizes.popAspect);

  return {
    cellWidth: cellPx / scale,
    cellHeight: heightPx / scale,
    rowPitch: (heightPx + gapPx) / scale,
    columnLeft: Array.from({ length: POP_COLUMNS }, (_, i) => (i * (cellPx + gapPx)) / scale),
  };
}

/** Клетка сетки: плитка «+», поп в пути или опубликованный поп. */
export type PopCell =
  { type: 'add' } | { type: 'pending'; pending: PendingPop } | { type: 'pop'; pop: Pop };

export type PopRow = { key: string; cells: PopCell[] };

/**
 * Клетки — строками по три: так край каждой плитки стоит на целом пикселе.
 * Ключ строки — её номер: новый поп сдвигает все плитки, и строки должны
 * переиспользоваться, а не пересоздаваться.
 */
export function toPopRows(cells: PopCell[]): PopRow[] {
  const rows: PopRow[] = [];

  for (let start = 0; start < cells.length; start += POP_COLUMNS) {
    rows.push({ key: String(start / POP_COLUMNS), cells: cells.slice(start, start + POP_COLUMNS) });
  }

  return rows;
}
