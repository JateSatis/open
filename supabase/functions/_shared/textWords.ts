/**
 * Слова текста и округление диапазона до целых слов — общие для адаптера
 * карты популярности и модели кластеров. Смещения — code points,
 * полуоткрытые `[start, end)`, как в базе.
 */

export type Range = { start: number; end: number };

/** Слово — подряд идущие непробельные code points; пунктуация прилипает. */
export function wordSpans(text: string): Range[] {
  const spans: Range[] = [];
  let start = -1;
  let i = 0;

  for (const ch of text) {
    const space = /\s/u.test(ch);

    if (!space && start < 0) start = i;

    if (space && start >= 0) {
      spans.push({ start, end: i });
      start = -1;
    }

    i += 1;
  }

  if (start >= 0) spans.push({ start, end: i });

  return spans;
}

/** Первое слово, которое кончается правее `pos`. */
export function firstWordEndingAfter(words: Range[], pos: number): number {
  let lo = 0;
  let hi = words.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (words[mid].end > pos) hi = mid;
    else lo = mid + 1;
  }

  return lo;
}

/** Первое слово, которое начинается не левее `pos`. */
export function firstWordStartingFrom(words: Range[], pos: number): number {
  let lo = 0;
  let hi = words.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (words[mid].start >= pos) hi = mid;
    else lo = mid + 1;
  }

  return lo;
}

/**
 * Диапазон по целым словам: берутся первые `maxLength` символов, слово
 * входит, если внутри не меньше его половины. Ни одно не вошло — слово с
 * наибольшим перекрытием или ближайшее. Не влезло в `maxLength` — слова
 * отпадают с конца; одно слово длиннее лимита режется по лимиту.
 */
export function roundToWords(range: Range, words: Range[], maxLength: number): Range | null {
  if (words.length === 0) return null;

  const s = range.start;
  const e = Math.min(range.end, s + maxLength);
  const a = firstWordEndingAfter(words, s);
  let first = -1;
  let last = -1;
  let bestOverlap = 0;
  let bestWord = -1;

  for (let w = a; w < words.length && words[w].start < e; w += 1) {
    const overlap = Math.min(e, words[w].end) - Math.max(s, words[w].start);

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestWord = w;
    }

    if (2 * overlap >= words[w].end - words[w].start) {
      if (first < 0) first = w;
      last = w;
    }
  }

  if (first < 0) {
    if (bestWord < 0) {
      // Диапазон весь в пробелах — ближайшее слово, при равенстве левое.
      const left = a - 1;
      const right = a < words.length ? a : -1;

      if (left < 0) bestWord = right;
      else if (right < 0) bestWord = left;
      else bestWord = s - words[left].end <= words[right].start - e ? left : right;
    }

    first = bestWord;
    last = bestWord;
  }

  while (last > first && words[last].end - words[first].start > maxLength) last -= 1;

  const start = words[first].start;

  return { start, end: Math.min(words[last].end, start + maxLength) };
}
