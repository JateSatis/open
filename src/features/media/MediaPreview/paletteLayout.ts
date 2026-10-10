import { DRAW_PALETTE_COLUMNS, DrawColors, DrawPalette, Sizes } from '@/theme';

export type PaletteCell = {
  row: number;
  column: number;
  rect: { x: number; y: number; width: number; height: number };
};

export type PaletteLayout = {
  columns: number;
  /** Сторона квадратика. */
  cell: number;
  height: number;
  /** По рядам, слева направо. */
  cells: PaletteCell[];
};

/** Квадратики сетки во всю ширину, с зазором между ними. */
export function paletteLayout(width: number): PaletteLayout {
  const columns = DRAW_PALETTE_COLUMNS;
  const rows = DrawPalette.length;
  const gap = Sizes.drawPaletteGap;
  const cell = Math.max(0, (width - gap * (columns - 1)) / columns);
  const cells: PaletteCell[] = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      cells.push({
        row,
        column,
        rect: { x: column * (cell + gap), y: row * (cell + gap), width: cell, height: cell },
      });
    }
  }

  return { columns, cell, height: rows * cell + (rows - 1) * gap, cells };
}

/** Какой квадратик под точкой; зазор справа и снизу от квадратика — его же, за краем — никакой. */
export function paletteCellAt(
  layout: PaletteLayout,
  x: number,
  y: number,
): { row: number; column: number } | null {
  const step = layout.cell + Sizes.drawPaletteGap;

  if (step <= 0 || x < 0 || y < 0) return null;

  const column = Math.floor(x / step);
  const row = Math.floor(y / step);

  if (column >= layout.columns || row >= DrawPalette.length) return null;

  return { row, column };
}

/** Где в сетке этот цвет `#rrggbb`; не из сетки (взят пипеткой) — нигде. */
export function paletteCellOf(rgb: string): { row: number; column: number } | null {
  for (let row = 0; row < DrawPalette.length; row++) {
    const column = DrawPalette[row].indexOf(rgb);

    if (column !== -1) return { row, column };
  }

  return null;
}

/** Яркость цвета по восприятию, 0…1. */
function luminance(rgb: string): number {
  'worklet';
  const r = parseInt(rgb.slice(1, 3), 16) / 255;
  const g = parseInt(rgb.slice(3, 5), 16) / 255;
  const b = parseInt(rgb.slice(5, 7), 16) / 255;

  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Светлая шахматная клетка в среднем — такой фон просвечивает сквозь прозрачный цвет. */
const CHECKER_LUMINANCE = 0.85;

/**
 * Обводка выбранного квадратика — что виднее на нём: чёрная на светлом,
 * белая на тёмном. Прозрачный цвет светлеет от клетки под ним.
 */
export function outlineFor(rgb: string, alpha: number): string {
  'worklet';
  const seen = luminance(rgb) * alpha + CHECKER_LUMINANCE * (1 - alpha);

  return seen > 0.5 ? DrawColors.outlineOnLight : DrawColors.outlineOnDark;
}
