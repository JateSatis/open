import type { ColorAdjust } from './types';

/** Положение ползунка: от −100 до 100, ноль посередине. */
export const ADJUST_MIN = -100;
export const ADJUST_MAX = 100;

/** Экспозиция на краю ползунка — ±1 ступень: вдвое светлее или темнее. */
const EXPOSURE_STOPS = 1;
/** Контраст на краю ползунка: наклон кривой от 0.4 до 1.6. */
const CONTRAST_SPAN = 0.6;

/** Яркость по Rec. 709 — с ней насыщенность уходит в ч/б без сдвига светлоты. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * Правка цвета → матрица 4×5 для Skia (`ColorMatrix`, `ColorFilter.MakeMatrix`):
 * строки R, G, B, A, в каждой четыре множителя и сдвиг в долях от 0 до 1.
 *
 * Одна функция и для живого показа (считается в ворклете из ползунков), и для
 * запекания при отправке: отправленное фото совпадает с увиденным.
 *
 * Порядок внутри цвета: экспозиция → контраст → насыщенность.
 * - экспозиция умножает каналы на 2^(e/100), то есть ±1 ступень;
 * - контраст наклоняет кривую вокруг середины: (x − 0.5)·k + 0.5,
 *   k = 1 + 0.6·c/100;
 * - насыщенность смешивает цвет с его яркостью: v = 1 + s/100, при −100 —
 *   чистое ч/б, при +100 — вдвое насыщеннее.
 *
 * Насыщенность не сдвигает серое (строки её матрицы в сумме дают 1), поэтому
 * сдвиг контраста проходит через неё как есть.
 */
export function adjustColorMatrix(adjust: ColorAdjust): number[] {
  'worklet';
  const gain = Math.pow(2, (adjust.exposure / 100) * EXPOSURE_STOPS);
  const slope = 1 + (adjust.contrast / 100) * CONTRAST_SPAN;
  const shift = 0.5 * (1 - slope);
  const v = 1 + adjust.saturation / 100;
  const scale = gain * slope;

  const rest = 1 - v;
  const r = LUMA_R * rest;
  const g = LUMA_G * rest;
  const b = LUMA_B * rest;

  // prettier-ignore
  return [
    (r + v) * scale, g * scale, b * scale, 0, shift,
    r * scale, (g + v) * scale, b * scale, 0, shift,
    r * scale, g * scale, (b + v) * scale, 0, shift,
    0, 0, 0, 1, 0,
  ];
}

/** Применить матрицу к цвету (каналы 0..1) — так же, как это делает Skia. Для тестов. */
export function applyColorMatrix(
  matrix: number[],
  [red, green, blue]: [number, number, number],
): [number, number, number] {
  const channel = (row: number) => {
    const at = row * 5;
    const value =
      matrix[at] * red + matrix[at + 1] * green + matrix[at + 2] * blue + matrix[at + 4];

    return Math.min(1, Math.max(0, value));
  };

  return [channel(0), channel(1), channel(2)];
}
