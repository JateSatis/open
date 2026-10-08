// Масштаб строки реакций зрителей. Строка никогда не прокручивается и
// обязана влезать в облачко: не влезает — уменьшается целиком, вплоть до
// `VISITOR_MIN_SCALE`. Всё в ней — шрифт, отступы, зазоры — от одного
// масштаба, поэтому ширина строки ему пропорциональна.

import { Spacing, Typography } from '@/theme';

/** Мельче этого эмодзи и числа перестают различаться. */
export const VISITOR_MIN_SCALE = 0.7;

const FONT = Typography.caption.fontSize;
/** Эмодзи шире буквы, цифры уже: с запасом, чтобы оценка не оказалась меньше настоящей. */
const EMOJI_WIDTH = FONT * 1.3;
const CHAR_WIDTH = FONT * 0.62;

/** Отступы строки зрителей при масштабе 1. */
export const VISITOR_LINE = {
  /** Внутри реакции: поля подложки и зазор между эмодзи и числом. */
  padding: Spacing.one,
  inner: Spacing.half,
  /** Между реакциями. */
  between: Spacing.one,
} as const;

/**
 * Ширина строки без уменьшения — по числу знаков. Это первая догадка до
 * замера: по ней облачко с первого кадра получает ширину, в которую строка
 * влезет хотя бы в самом мелком виде.
 */
export function estimateLineWidth(entries: readonly (readonly [string, string])[]): number {
  if (entries.length === 0) return 0;

  const items = entries.reduce(
    (sum, [, count]) =>
      sum + VISITOR_LINE.padding * 2 + VISITOR_LINE.inner + EMOJI_WIDTH + count.length * CHAR_WIDTH,
    0,
  );

  return items + VISITOR_LINE.between * (entries.length - 1);
}

/** Масштаб, с которым строка ширины `natural` влезает в `available`. */
export function fitScale(natural: number, available: number): number {
  if (natural <= 0 || natural <= available) return 1;

  return Math.max(VISITOR_MIN_SCALE, available / natural);
}
