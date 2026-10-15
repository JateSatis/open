// Смещения в тексте сообщения. В JS строки — UTF-16, в базе диапазоны
// фрагментов — code points (как `char_length` и `substr` Postgres). Переводы —
// только здесь.
//
// Границы символов — расширенные графемы (UAX #29) в той части, что
// встречается в переписке: суррогатные пары, комбинирующие знаки, вариационные
// селекторы, модификаторы цвета кожи, ZWJ-последовательности эмодзи, флаги из
// двух региональных индикаторов, флаги-теги, слоги хангыля. Ручка выделения
// ходит только по этим границам: эмодзи и буква с ударением выделяются целиком.
// `Intl.Segmenter` в Hermes нет — своё.

const EXTEND = /^[\p{M}‌\u{E0020}-\u{E007F}\u{1F3FB}-\u{1F3FF}]$/u;
const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u;
const REGIONAL = /^[\u{1F1E6}-\u{1F1FF}]$/u;
const WORD = /^[\p{L}\p{N}\p{M}_]$/u;
/** Внутри слова: «кто-то», «don't», «3.14». */
const JOINER = /^['’\-.·]$/u;

const ZWJ = '‍';

type Hangul = 'L' | 'V' | 'T' | 'LV' | 'LVT' | null;

function hangul(code: number): Hangul {
  if ((code >= 0x1100 && code <= 0x115f) || (code >= 0xa960 && code <= 0xa97c)) return 'L';
  if ((code >= 0x1160 && code <= 0x11a7) || (code >= 0xd7b0 && code <= 0xd7c6)) return 'V';
  if ((code >= 0x11a8 && code <= 0x11ff) || (code >= 0xd7cb && code <= 0xd7fb)) return 'T';
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? 'LV' : 'LVT';

  return null;
}

/** Слог хангыля не рвётся между этими частями. */
function joinsHangul(before: Hangul, after: Hangul): boolean {
  if (before === 'L') return after === 'L' || after === 'V' || after === 'LV' || after === 'LVT';
  if (before === 'LV' || before === 'V') return after === 'V' || after === 'T';
  if (before === 'LVT' || before === 'T') return after === 'T';

  return false;
}

/** Кодовые точки строки с их смещениями в UTF-16. */
function codePoints(text: string): { char: string; at: number }[] {
  const points: { char: string; at: number }[] = [];
  let at = 0;

  for (const char of text) {
    points.push({ char, at });
    at += char.length;
  }

  return points;
}

/**
 * Границы графем в UTF-16: от 0 до `text.length` включительно, по
 * возрастанию. Выделение начинается и кончается только на них.
 */
export function graphemeBoundaries(text: string): number[] {
  const points = codePoints(text);
  const bounds = [0];
  let regionalRun = 0;
  // Последовательность эмодзи: пиктограмма, за ней расширители — ZWJ
  // приклеивает следующую пиктограмму.
  let inPictographic = false;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].char;
    const next = points[i].char;
    const prevCode = prev.codePointAt(0) ?? 0;
    const nextCode = next.codePointAt(0) ?? 0;

    if (PICTOGRAPHIC.test(prev)) inPictographic = true;
    else if (!EXTEND.test(prev) && prev !== ZWJ) inPictographic = false;

    regionalRun = REGIONAL.test(prev) ? regionalRun + 1 : 0;

    const glued =
      (prev === '\r' && next === '\n') ||
      EXTEND.test(next) ||
      next === ZWJ ||
      // Вариационный селектор эмодзи — тоже расширитель (\p{M}).
      (prev === ZWJ && inPictographic && PICTOGRAPHIC.test(next)) ||
      (REGIONAL.test(next) && regionalRun % 2 === 1) ||
      joinsHangul(hangul(prevCode), hangul(nextCode));

    if (!glued) bounds.push(points[i].at);
  }

  if (text.length > 0) bounds.push(text.length);

  return bounds;
}

/**
 * Не больше `max` символов (графем) текста; длиннее — обрезка с многоточием.
 * Эмодзи и буква с ударением не разрезаются.
 */
export function truncateGraphemes(text: string, max: number): string {
  const bounds = graphemeBoundaries(text);

  // Границ на одну больше, чем графем: и начало, и конец текста.
  if (bounds.length - 1 <= max) return text;

  return `${text.slice(0, bounds[max])}…`;
}

/** Ближайшая граница графемы к смещению: та, что не дальше, при равенстве — левая. */
export function snapToBoundary(bounds: readonly number[], offset: number): number {
  let best = bounds[0] ?? 0;

  for (const bound of bounds) {
    if (Math.abs(bound - offset) < Math.abs(best - offset)) best = bound;
  }

  return best;
}

/** Граница графемы не правее смещения. */
export function boundaryAtOrBefore(bounds: readonly number[], offset: number): number {
  let found = bounds[0] ?? 0;

  for (const bound of bounds) {
    if (bound > offset) break;
    found = bound;
  }

  return found;
}

/** Граница графемы не левее смещения. */
export function boundaryAtOrAfter(bounds: readonly number[], offset: number): number {
  for (const bound of bounds) {
    if (bound >= offset) return bound;
  }

  return bounds[bounds.length - 1] ?? 0;
}

function isWordGrapheme(text: string, start: number, end: number): boolean {
  const first = String.fromCodePoint(text.codePointAt(start) ?? 0);

  return end > start && WORD.test(first);
}

/**
 * Слово под смещением — что выделяет долгое нажатие: буквы и цифры подряд,
 * со знаками внутри слова («кто-то»). Не слово (эмодзи, знак препинания,
 * пробел) — одна графема под пальцем. Диапазон — UTF-16 `[start, end)`.
 */
export function wordAt(text: string, offset: number): { start: number; end: number } {
  const bounds = graphemeBoundaries(text);

  if (bounds.length < 2) return { start: 0, end: 0 };

  // Графема под смещением: последняя граница не правее, конец — следующая.
  let index = 0;

  for (let i = 0; i < bounds.length - 1; i++) {
    if (bounds[i] <= offset) index = i;
  }

  const at = (i: number) => ({ start: bounds[i], end: bounds[i + 1] });
  const isWord = (i: number) => isWordGrapheme(text, bounds[i], bounds[i + 1]);
  const isJoiner = (i: number) =>
    bounds[i + 1] - bounds[i] === 1 && JOINER.test(text[bounds[i]]);

  if (!isWord(index)) {
    // Палец между словом и пробелом в конце строки — берём слово слева.
    if (index > 0 && isWord(index - 1) && /\s/.test(text[bounds[index]])) index -= 1;
    else return at(index);
  }

  let first = index;
  let last = index;

  while (first > 0 && (isWord(first - 1) || (isJoiner(first - 1) && first > 1 && isWord(first - 2)))) {
    first -= 1;
  }

  const graphemes = bounds.length - 1;

  while (
    last < graphemes - 1 &&
    (isWord(last + 1) || (isJoiner(last + 1) && last + 2 < graphemes && isWord(last + 2)))
  ) {
    last += 1;
  }

  return { start: bounds[first], end: bounds[last + 1] };
}

/** UTF-16 → code points: сколько кодовых точек до этого смещения. */
export function toCodePointOffset(text: string, utf16: number): number {
  let points = 0;
  let at = 0;

  for (const char of text) {
    if (at >= utf16) break;
    at += char.length;
    points += 1;
  }

  return points;
}

/** Code points → UTF-16. За концом текста — длина текста. */
export function toUtf16Offset(text: string, codePoint: number): number {
  let points = 0;
  let at = 0;

  for (const char of text) {
    if (points >= codePoint) return at;
    at += char.length;
    points += 1;
  }

  return at;
}

/** Диапазон UTF-16 → диапазон для базы: code points и сам кусок текста. */
export function toServerRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number; text: string } {
  return {
    start: toCodePointOffset(text, start),
    end: toCodePointOffset(text, end),
    text: text.slice(start, end),
  };
}

/** Диапазон из базы (code points) → UTF-16 этого текста. */
export function fromServerRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  return { start: toUtf16Offset(text, start), end: toUtf16Offset(text, end) };
}
