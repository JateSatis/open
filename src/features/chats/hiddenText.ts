// Скрытый текст: куски своего сообщения, которые автор скрыл от зрителей.
//
// Диапазоны — `[start, end)` в code points, как в базе. Участник чата
// получает оригинал и диапазоны (на них — тихая пометка), зритель — текст,
// где каждый скрытый символ заменён «•», и те же диапазоны (на них —
// «замазка»). Что именно пришло, видно по самому тексту: замену делает
// сервер, клиент её не изобретает.

import { toCodePointOffset, toUtf16Offset } from '@/features/chats/fragments/textOffsets';

export type HiddenRange = { start: number; end: number };

/** Символ, которым сервер замазывает скрытое для зрителей. */
export const HIDDEN_MASK_CHAR = '•';

/** Диапазоны из ответа базы: `[[start, end], …]`. Мусор — пропускается. */
export function parseHiddenRanges(value: unknown): HiddenRange[] {
  if (!Array.isArray(value)) return [];

  return normalizeRanges(
    value.flatMap((pair) =>
      Array.isArray(pair) &&
      pair.length === 2 &&
      typeof pair[0] === 'number' &&
      typeof pair[1] === 'number' &&
      pair[0] >= 0 &&
      pair[1] > pair[0]
        ? [{ start: pair[0], end: pair[1] }]
        : [],
    ),
  );
}

/** Для базы: json-параметр функций. */
export function hiddenRangesJson(ranges: readonly HiddenRange[]): [number, number][] {
  return normalizeRanges(ranges).map((r) => [r.start, r.end]);
}

/** Для базы: литерал int4multirange — прямая вставка текстового сообщения. */
export function hiddenRangesLiteral(ranges: readonly HiddenRange[]): string {
  return `{${normalizeRanges(ranges)
    .map((r) => `[${r.start},${r.end})`)
    .join(',')}}`;
}

/** По порядку, без пустых, пересекающиеся и соседние — склеены. */
export function normalizeRanges(ranges: readonly HiddenRange[]): HiddenRange[] {
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .map((r) => ({ start: Math.max(0, r.start), end: r.end }))
    .sort((a, b) => a.start - b.start);
  const merged: HiddenRange[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];

    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  return merged;
}

export function addRange(ranges: readonly HiddenRange[], range: HiddenRange): HiddenRange[] {
  return normalizeRanges([...ranges, range]);
}

export function removeRange(ranges: readonly HiddenRange[], cut: HiddenRange): HiddenRange[] {
  return normalizeRanges(
    ranges.flatMap((r) => {
      if (cut.end <= r.start || cut.start >= r.end) return [r];

      return [
        { start: r.start, end: Math.min(r.end, cut.start) },
        { start: Math.max(r.start, cut.end), end: r.end },
      ];
    }),
  );
}

/** Задевает ли кусок `[start, end)` что-нибудь скрытое. */
export function overlapsHidden(
  ranges: readonly HiddenRange[],
  start: number,
  end: number,
): boolean {
  return ranges.some((r) => start < r.end && end > r.start);
}

/** Весь кусок `[start, end)` уже скрыт. */
export function coveredByHidden(
  ranges: readonly HiddenRange[],
  start: number,
  end: number,
): boolean {
  return normalizeRanges(ranges).some((r) => r.start <= start && r.end >= end);
}

/**
 * Пришёл ли текст замазанным — то есть я зритель. Каждый символ каждого
 * диапазона — «•»: оригинал со сплошными «•» на месте скрытого невероятен.
 */
export function isMaskedText(text: string, ranges: readonly HiddenRange[]): boolean {
  if (ranges.length === 0) return false;

  const points = Array.from(text);

  return ranges.every(
    (r) =>
      r.end <= points.length && points.slice(r.start, r.end).every((c) => c === HIDDEN_MASK_CHAR),
  );
}

export type TextSegment = { text: string; hidden: boolean };

/** Текст кусками для отрисовки: открытые и скрытые по очереди. */
export function hiddenSegments(text: string, ranges: readonly HiddenRange[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let at = 0;

  for (const range of normalizeRanges(ranges)) {
    const start = toUtf16Offset(text, range.start);
    const end = toUtf16Offset(text, range.end);

    if (start >= text.length) break;
    if (start > at) segments.push({ text: text.slice(at, start), hidden: false });
    if (end > start) segments.push({ text: text.slice(start, end), hidden: true });
    at = Math.max(at, end);
  }

  if (at < text.length) segments.push({ text: text.slice(at), hidden: false });

  return segments;
}

/**
 * Диапазоны после правки текста: общее начало и общий конец старого и нового
 * текста не тронуты, середина заменена. Скрытое до правки остаётся на месте,
 * после — сдвигается, задетое правкой — растягивается или сжимается вместе
 * с ней. Пустое — уходит.
 */
export function shiftRanges(
  before: string,
  after: string,
  ranges: readonly HiddenRange[],
): HiddenRange[] {
  if (ranges.length === 0 || before === after) return [...ranges];

  const oldPoints = Array.from(before);
  const newPoints = Array.from(after);
  let prefix = 0;

  while (
    prefix < oldPoints.length &&
    prefix < newPoints.length &&
    oldPoints[prefix] === newPoints[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;

  while (
    suffix < oldPoints.length - prefix &&
    suffix < newPoints.length - prefix &&
    oldPoints[oldPoints.length - 1 - suffix] === newPoints[newPoints.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldEnd = oldPoints.length - suffix;
  const newEnd = newPoints.length - suffix;
  const delta = newEnd - oldEnd;
  // Вставка ровно на краю скрытого в него не попадает: набранное перед ним и
  // после него остаётся открытым. Заменённое внутри — скрытым.
  const map = (x: number, side: 'start' | 'end') => {
    if (side === 'start') {
      if (x >= oldEnd) return x + delta;

      return x <= prefix ? x : prefix;
    }

    if (x <= prefix) return x;

    return x >= oldEnd ? x + delta : newEnd;
  };

  return normalizeRanges(
    ranges.map((r) => ({ start: map(r.start, 'start'), end: map(r.end, 'end') })),
  ).filter((r) => r.end <= newPoints.length);
}

/** Выделение поля ввода (UTF-16) → диапазон в code points. */
export function selectionToRange(text: string, start: number, end: number): HiddenRange {
  const from = Math.min(start, end);
  const to = Math.max(start, end);

  return { start: toCodePointOffset(text, from), end: toCodePointOffset(text, to) };
}

/**
 * Текст без пробелов по краям — как его сохранит база, — и диапазоны,
 * сдвинутые под него. Скрытое, целиком ушедшее в обрезанные края, пропадает.
 */
export function trimWithRanges(
  text: string,
  ranges: readonly HiddenRange[],
): { text: string; ranges: HiddenRange[] } {
  const trimmed = text.trim();
  const lead = Array.from(text.slice(0, text.length - text.trimStart().length)).length;
  const length = Array.from(trimmed).length;

  return {
    text: trimmed,
    ranges: normalizeRanges(
      ranges.map((r) => ({
        start: Math.min(Math.max(r.start - lead, 0), length),
        end: Math.min(Math.max(r.end - lead, 0), length),
      })),
    ),
  };
}

/** Один и тот же набор скрытого. */
export function sameRanges(a: readonly HiddenRange[], b: readonly HiddenRange[]): boolean {
  const left = normalizeRanges(a);
  const right = normalizeRanges(b);

  return (
    left.length === right.length &&
    left.every((r, i) => r.start === right[i].start && r.end === right[i].end)
  );
}
