import { ALL_REACTIONS } from '@/features/interactions/reactionSet';
import { Sizes, Spacing } from '@/theme';

/** Больше в ряд не ставим: основных семь, плюс кнопка раскрытия. */
const MAX_COLUMNS = 8;
/** Уже этого блок перестаёт быть полосой. */
const MIN_COLUMNS = 5;

export const PICKER_PADDING = Spacing.one;

export type PickerGeometry = {
  columns: number;
  width: number;
  /** Свёрнутый — одна полоса. */
  collapsedHeight: number;
  /** Раскрытый целиком; на экран может не влезть — тогда прокручивается. */
  expandedHeight: number;
  /** Первая полоса: основные, за ними справа — кнопка раскрытия. */
  firstRow: readonly string[];
  /** Остальное — ниже, сеткой. */
  rest: readonly string[];
};

/** Раскладка блока под ширину, которая ему доступна. */
export function pickerGeometry(availableWidth: number): PickerGeometry {
  const fit = Math.floor((availableWidth - PICKER_PADDING * 2) / Sizes.reactionCell);
  const columns = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, fit));
  const firstRow = ALL_REACTIONS.slice(0, columns - 1);
  const rest = ALL_REACTIONS.slice(columns - 1);
  const rows = 1 + Math.ceil(rest.length / columns);

  return {
    columns,
    width: columns * Sizes.reactionCell + PICKER_PADDING * 2,
    collapsedHeight: Sizes.reactionCell + PICKER_PADDING * 2,
    expandedHeight: rows * Sizes.reactionCell + PICKER_PADDING * 2,
    firstRow,
    rest,
  };
}
