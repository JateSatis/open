/**
 * Адаптер «фрагменты → карта популярности» — первый слой модели кластеров.
 *
 * Каждый человек рисует над текстом свой слой: в точке его слой равен весу
 * самого сильного из его фрагментов, покрывающих точку (максимум, не сумма;
 * комментарий весит больше реакции). Слои людей складываются. Пять букв
 * «Трамп» одного человека по отдельности дают ту же высоту, что одно его
 * выделение всего слова; тридцать одинаковых фрагментов внахлёст — как один.
 *
 * Карта — по словам (слово — подряд идущие непробельные символы), три канала:
 * - `height` — высота слова: сумма слоёв людей, у которых слово «входит» в
 *   слой — покрыто не меньше чем наполовину (то же правило, что у
 *   `roundToWords`). Считается по каждому человеку отдельно, а не квантилем
 *   суммы: два человека, выделившие по три буквы из пяти с разных концов,
 *   дают слову высоту 2, а не 1;
 * - `people` — сколько людей в слове (слой любого веса);
 * - `continuity` — на границе между соседними словами: вес людей, чьё
 *   выделение идёт через границу одним куском. Два соседних куска от разных
 *   людей одинаковой высоты — это ноль на общей границе, естественный разрез;
 *   одно общее выделение — сплошное плато;
 * - `starts` / `ends` — вес кусков, начинающихся на слове (и идущих дальше)
 *   и кончающихся на нём (придя слева). Стык внахлёст — одни люди кончают
 *   выделение на слове, другие с него начинают — виден как разрез внутри
 *   слова, хотя через границы идут и те и другие.
 *
 * Из фрагментов наружу уходят только агрегаты: карта и `MessageContext`
 * (сколько людей, какой длины кусками выделяют). Модель о фрагментах ничего
 * не знает — будущий отдельный сервис примет ровно этот вход.
 *
 * Сложность — O(F log F + W): сортировка кусков человека, разности по словам.
 */

import { firstWordEndingAfter, firstWordStartingFrom, type Range } from './textWords.ts';

export const HEIGHT_MAP_VERSION = 1;

export type HeightMap = {
  version: typeof HEIGHT_MAP_VERSION;
  textLength: number;
  /** Слова текста, code points. */
  words: Range[];
  /** Высота слова — сумма весов слоёв людей. */
  height: number[];
  /** Людей в слове. */
  people: number[];
  /** Длина `words.length - 1`: вес людей, идущих через границу `i | i + 1` одним куском. */
  continuity: number[];
  /** Вес кусков, которые начинаются на слове и идут дальше вправо. */
  starts: number[];
  /** Вес кусков, которые пришли слева и кончаются на слове. */
  ends: number[];
};

export type MessageContext = {
  version: typeof HEIGHT_MAP_VERSION;
  textLength: number;
  wordCount: number;
  /** Разных людей (удалённый аккаунт — человек на каждый голос). */
  people: number;
  /** Кусков выделения: слитые фрагменты человека — один кусок. */
  pieces: number;
  /** Медиана ln(длины куска в словах) — какой длины кусками выделяют в этом сообщении. */
  pieceLogLengthMedian: number;
  /** Разброс ln(длины куска): медианное отклонение · 1.4826. */
  pieceLogLengthSpread: number;
  /** Средний вес человека в слове: высота / люди. Переводит высоту в «людей» для статистики. */
  meanWeight: number;
  /** Что было отображено до пересчёта, code points. */
  previousDisplays: Range[];
};

/** Один фрагмент человека: диапазон и вес его самого сильного голоса на нём. */
export type PersonPiece = { start: number; end: number; weight: number };

type Mode = 'half' | 'any';

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;

  const mid = sorted.length >> 1;

  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Слитые куски уровня: пересекающиеся и касающиеся — один. `pieces` отсортированы по началу. */
function mergeLevel(pieces: PersonPiece[], weight: number): Range[] {
  const out: Range[] = [];

  for (const p of pieces) {
    if (p.weight < weight) continue;

    const last = out[out.length - 1];

    if (last && p.start <= last.end) {
      if (p.end > last.end) last.end = p.end;
    } else {
      out.push({ start: p.start, end: p.end });
    }
  }

  return out;
}

function build(
  length: number,
  words: Range[],
  persons: PersonPiece[][],
  previousDisplays: Range[],
  mode: Mode,
) {
  const W = words.length;
  const heightDiff = new Float64Array(W + 1);
  const peopleDiff = new Float64Array(W + 1);
  const contDiff = new Float64Array(W + 1);
  const startsAt = new Float64Array(W);
  const endsAt = new Float64Array(W);
  const heightPoint = new Float64Array(W);
  const peoplePoint = new Float64Array(W);
  const logLengths: number[] = [];
  const enters = (covered: number, w: number) =>
    mode === 'half' ? 2 * covered >= words[w].end - words[w].start : covered > 0;

  persons.forEach((own) => {
    const pieces = [...own].sort(
      (a, b) => a.start - b.start || a.end - b.end || a.weight - b.weight,
    );
    const levels = [...new Set(pieces.map((p) => p.weight))].sort((a, b) => a - b);
    let below = 0;

    levels.forEach((weight, level) => {
      const delta = weight - below;
      const base = level === 0;
      // Края куска покрывают слово частично; несколько кусков человека на
      // одном уровне могут вместе закрыть половину слова. Куски уровня не
      // пересекаются и идут по порядку — общее слово бывает только у соседних.
      let pendingWord = -1;
      let pendingCovered = 0;
      const flush = () => {
        if (pendingWord >= 0 && enters(pendingCovered, pendingWord)) {
          heightPoint[pendingWord] += delta;
          if (base) peoplePoint[pendingWord] += 1;
        }
      };

      below = weight;

      for (const { start: s, end: e } of mergeLevel(pieces, weight)) {
        const a = firstWordEndingAfter(words, s);
        const b = firstWordStartingFrom(words, e) - 1;

        if (a >= W || a > b) {
          if (base) logLengths.push(0);
          continue;
        }

        const fa = words[a].start >= s ? a : a + 1;
        const fb = words[b].end <= e ? b : b - 1;
        let ia = fa <= fb ? fa : -1;
        let ib = fa <= fb ? fb : -1;

        if (fa <= fb) {
          heightDiff[fa] += delta;
          heightDiff[fb + 1] -= delta;

          if (base) {
            peopleDiff[fa] += 1;
            peopleDiff[fb + 1] -= 1;
          }
        }

        for (const w of a === b ? [a] : [a, b]) {
          if (w >= fa && w <= fb) continue;

          const covered = Math.min(e, words[w].end) - Math.max(s, words[w].start);

          if (w === pendingWord) {
            pendingCovered += covered;
          } else {
            flush();
            pendingWord = w;
            pendingCovered = covered;
          }

          if (enters(covered, w)) {
            if (ia < 0 || w < ia) ia = w;
            if (ib < 0 || w > ib) ib = w;
          }
        }

        if (ia >= 0 && ib > ia) {
          contDiff[ia] += delta;
          contDiff[ib] -= delta;
          startsAt[ia] += delta;
          endsAt[ib] += delta;
        }

        if (base) logLengths.push(Math.log(ia >= 0 ? ib - ia + 1 : 1));
      }

      flush();
    });
  });

  const height: number[] = new Array(W);
  const people: number[] = new Array(W);
  const continuity: number[] = new Array(Math.max(0, W - 1));
  const starts = Array.from(startsAt, (x) => Math.round(x * 1e9) / 1e9);
  const ends = Array.from(endsAt, (x) => Math.round(x * 1e9) / 1e9);
  let h = 0;
  let n = 0;
  let c = 0;
  let heightSum = 0;
  let peopleSum = 0;

  for (let w = 0; w < W; w += 1) {
    h += heightDiff[w];
    n += peopleDiff[w];
    // Округление гасит хвосты сложений с плавающей точкой.
    height[w] = Math.round((h + heightPoint[w]) * 1e9) / 1e9;
    people[w] = Math.round(n + peoplePoint[w]);
    heightSum += height[w];
    peopleSum += people[w];

    if (w < W - 1) {
      c += contDiff[w];
      continuity[w] = Math.round(c * 1e9) / 1e9;
    }
  }

  logLengths.sort((x, y) => x - y);

  const center = median(logLengths);
  const spread = 1.4826 * median(logLengths.map((x) => Math.abs(x - center)).sort((x, y) => x - y));

  const map: HeightMap = {
    version: HEIGHT_MAP_VERSION,
    textLength: length,
    words,
    height,
    people,
    continuity,
    starts,
    ends,
  };
  const context: MessageContext = {
    version: HEIGHT_MAP_VERSION,
    textLength: length,
    wordCount: W,
    people: persons.length,
    pieces: logLengths.length,
    pieceLogLengthMedian: center,
    pieceLogLengthSpread: spread,
    meanWeight: peopleSum > 0 ? heightSum / peopleSum : 1,
    previousDisplays,
  };

  return { map, context, empty: heightSum === 0 };
}

/**
 * Карта и характеристики сообщения из кусков людей. Если ни одно слово не
 * покрыто наполовину ни одним человеком (все выделили по букве), слово
 * входит при любом пересечении — иначе у сообщения с фрагментами не было бы
 * ни одной горы.
 */
export function buildHeightMap(
  length: number,
  words: Range[],
  persons: PersonPiece[][],
  previousDisplays: Range[] = [],
): { map: HeightMap; context: MessageContext } {
  const half = build(length, words, persons, previousDisplays, 'half');

  if (!half.empty || persons.length === 0) return half;

  return build(length, words, persons, previousDisplays, 'any');
}
