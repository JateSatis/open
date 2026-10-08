import { formatViewsCount } from '@/features/chats/ViewsCount/formatViewsCount';
import { ALL_REACTIONS } from '@/features/interactions/reactionSet';
import { Sizes, Spacing, Typography } from '@/theme';

/** Больше в ряд не ставим: основных семь, плюс кнопка раскрытия. */
const MAX_COLUMNS = 8;
/** Уже этого блок перестаёт быть полосой. */
const MIN_COLUMNS = 5;
/** Цифра числа у реакции — примерно такая доля кегля; с запасом, чтобы число не резалось. */
const DIGIT_SHARE = 0.62;

export const PICKER_PADDING = Spacing.one;

/** Реакция в блоке: эмодзи и, у зрителя, сколько таких уже стоит. */
export type PickerCell = { emoji: string; count: string | null; width: number };

export type PickerGeometry = {
  width: number;
  /** Свёрнутый — одна полоса; без раскрытия — все строки сразу. */
  collapsedHeight: number;
  /** Раскрытый целиком; на экран может не влезть — тогда прокручивается. */
  expandedHeight: number;
  /** Есть ли кнопка раскрытия: у полного набора зрителей всё видно сразу. */
  expandable: boolean;
  /** Первая полоса; за ней справа — кнопка раскрытия. */
  firstRow: readonly PickerCell[];
  /** Остальное — ниже, сеткой. */
  rest: readonly PickerCell[];
};

export type PickerOptions = {
  /**
   * Только эти реакции: ряд полон, новую разную база не примет. Нет — весь
   * набор.
   */
  options?: readonly string[];
  /** Сколько каждой уже стоит — число рядом с эмодзи (меню зрителя). */
  counts?: Readonly<Record<string, number>>;
  /** Кнопка раскрытия. Без неё все реакции видны сразу, строками. */
  expandable?: boolean;
};

/** Ширина числа рядом с эмодзи — по знакам, чтобы раскладка была известна до отрисовки. */
export function countWidth(label: string): number {
  return Math.ceil(label.length * Typography.caption.fontSize * DIGIT_SHARE) + Spacing.one;
}

function toCell(emoji: string, counts: PickerOptions['counts']): PickerCell {
  const count = counts?.[emoji];
  const label = count ? formatViewsCount(count) : null;

  return { emoji, count: label, width: Sizes.reactionCell + (label ? countWidth(label) : 0) };
}

/** Сколько строк займут ячейки при ширине строки `rowWidth` — так же, как их переносит `flexWrap`. */
function rowsOf(cells: readonly { width: number }[], rowWidth: number): number {
  let rows = 0;
  let used = rowWidth;

  for (const { width } of cells) {
    if (used + width > rowWidth) {
      rows += 1;
      used = 0;
    }

    used += width;
  }

  return rows;
}

/** Раскладка блока под ширину, которая ему доступна. */
export function pickerGeometry(availableWidth: number, opts: PickerOptions = {}): PickerGeometry {
  const { options = ALL_REACTIONS, counts, expandable = true } = opts;
  const fit = Math.floor((availableWidth - PICKER_PADDING * 2) / Sizes.reactionCell);
  const columns = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, fit));
  const rowWidth = columns * Sizes.reactionCell;
  const cells = options.map((emoji) => toCell(emoji, counts));
  const width = rowWidth + PICKER_PADDING * 2;

  if (!expandable) {
    const height = Math.max(1, rowsOf(cells, rowWidth)) * Sizes.reactionCell + PICKER_PADDING * 2;

    return {
      width,
      collapsedHeight: height,
      expandedHeight: height,
      expandable,
      firstRow: cells,
      rest: [],
    };
  }

  // Полоса — сколько влезает рядом с кнопкой раскрытия.
  const firstRow: PickerCell[] = [];
  let used = Sizes.reactionCell;

  for (const cell of cells) {
    if (used + cell.width > rowWidth) break;

    firstRow.push(cell);
    used += cell.width;
  }

  const rest = cells.slice(firstRow.length);

  // Всё влезло в полосу — раскрывать нечего.
  if (rest.length === 0) return pickerGeometry(availableWidth, { ...opts, expandable: false });

  return {
    width,
    collapsedHeight: Sizes.reactionCell + PICKER_PADDING * 2,
    expandedHeight: (1 + rowsOf(rest, rowWidth)) * Sizes.reactionCell + PICKER_PADDING * 2,
    expandable,
    firstRow,
    rest,
  };
}
