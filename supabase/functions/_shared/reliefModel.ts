/**
 * Модель «карта популярности → кластеры» — второй слой модели кластеров.
 *
 * Вход — только карта (`HeightMap`) и характеристики сообщения
 * (`MessageContext`); об отдельных фрагментах модель ничего не знает. Всё
 * здесь зависит от числа слов, а не от числа фрагментов.
 *
 * 1. Горы и бассейны. Карта — ряд «слово, граница, слово, …»; высота границы
 *    — сколько людей идёт через неё одним куском (`continuity`). Спуск
 *    ватерлинии сверху вниз (union-find по убыванию высоты) находит вершины и
 *    седловины между ними. Седловина делит две горы, только если впадина
 *    значима: младшая вершина выше седловины больше, чем объясняет случайный
 *    шум голосов. Голоса — пуассоновские, z = (вершина − седло) /
 *    √(вес · шум · (вершина + седло)): при 3 людях провал в одного человека —
 *    шум, та же форма при 300 — настоящий разрез. Ноль на границе (никто не
 *    идёт через неё) — разрез всегда.
 * 2. Варианты подсветки. В бассейне от вершины опускается ватерлиния; каждый
 *    раз, когда кусок над ней расширяется, прежний кусок — вариант. Вариантов
 *    не больше, чем слов в бассейне. Длиннее `maxDisplayLength` — не вариант;
 *    если уже верхнее плато длиннее, это ровный рельеф — первые слова плато.
 * 3. Оценка варианта — сменная функция признаков (`ScoringModel`): толщина
 *    слоя (насколько кусок выше соседей за краями), захват внимания бассейна,
 *    естественная длина (как в этом сообщении выделяют), покрытие текста,
 *    «уже показывался». Веса — функции характеристик сообщения.
 * 4. Набор отображаемых — точный выбор (динамика по отрезкам на прямой):
 *    наибольшая сумма ценностей без пересечений, мест — от длины текста,
 *    близкие соседи приглушают друг друга.
 */

import type { HeightMap, MessageContext } from './popularityMap.ts';
import { roundToWords, type Range } from './textWords.ts';

export type ReliefParams = {
  /** Порог z значимости впадины — уровень доверия статистического теста, не доля высоты. */
  significanceZ: number;
  /** Насколько шумный рельеф (лишние вершины) расширяет дисперсию голосов. */
  noiseInflation: number;
  /** Стартовые коэффициенты функции оценки (априорные). */
  weightThickness: number;
  weightCapture: number;
  weightPrecision: number;
  weightLength: number;
  /** При стольких людях доверие к «естественной длине» — половина. */
  lengthPeople: number;
  /** Нижняя граница разброса ln(длины), чтобы одна длина у всех не делала признак иглой. */
  lengthSpreadMin: number;
  weightCoverage: number;
  /** Бонус к ценности варианта, который уже был отображён: набор не мигает. */
  stableBonus: number;
  maxDisplayLength: number;
  /** Одно отображаемое место на столько символов сообщения. */
  slotChars: number;
  maxDisplayed: number;
  /** Насколько выбранный приглушает соседа вплотную (0..1). */
  densityPenalty: number;
  /** На каком расстоянии приглушение спадает в e раз, символов. */
  densityRadius: number;
  /** Цена ещё одного отображаемого — доля ценности лучшего варианта. */
  clutterCost: number;
  /** В журнал решения: вариантов на бассейн и бассейнов. */
  decisionCandidates: number;
  decisionBasins: number;
};

export const DEFAULT_RELIEF_PARAMS: ReliefParams = {
  significanceZ: 2,
  noiseInflation: 2,
  weightThickness: 1,
  weightCapture: 0.25,
  weightPrecision: 0,
  weightLength: 0.8,
  lengthPeople: 5,
  lengthSpreadMin: 0.7,
  weightCoverage: 0.3,
  stableBonus: 0.15,
  maxDisplayLength: 200,
  slotChars: 100,
  maxDisplayed: 8,
  densityPenalty: 0.6,
  densityRadius: 120,
  clutterCost: 0.1,
  decisionCandidates: 3,
  decisionBasins: 50,
};

/** Признаки варианта подсветки — вход функции оценки. */
export type CandidateFeatures = {
  /** (наименьшая высота внутри − наибольшая за краями) / вершина бассейна. */
  thickness: number;
  /** Доля внимания (массы высот) бассейна внутри куска. */
  capture: number;
  /** Средняя высота куска / вершина. */
  precision: number;
  /** Насколько длина куска в словах похожа на то, как выделяют в этом сообщении (0..1). */
  lengthFit: number;
  /** Доля текста под куском. */
  coverage: number;
  /** 1 — ровно этот кусок был отображён до пересчёта. */
  shownBefore: number;
  words: number;
  chars: number;
  /** 1 — ровное плато длиннее лимита, взяты его первые слова. */
  trimmed: number;
};

/** Характеристики сообщения плюс выведенные из карты. */
export type ScoringContext = MessageContext & {
  /** Разброс внимания по тексту: стандартное отклонение позиции / длина (0..0.5). */
  spread: number;
  /** Лишние вершины на слово с высотой: рябь рельефа (0..1). */
  noise: number;
  /** Множитель дисперсии голосов от ряби. */
  dispersion: number;
};

/** Сменная функция оценки: признаки → оценка. Её заменит обученная модель. */
export type ScoringModel = {
  id: string;
  weights: (context: ScoringContext) => Record<string, number>;
  score: (features: CandidateFeatures, weights: Record<string, number>) => number;
};

/** Линейная оценка со стартовыми коэффициентами, веса зависят от сообщения. */
export function linearScoringModel(p: ReliefParams): ScoringModel {
  return {
    id: 'linear-1',
    weights: (ctx) => ({
      // Рябь делает толщину тонкого слоя ненадёжной.
      thickness: p.weightThickness / ctx.dispersion,
      // Внимание размазано по тексту — ценнее кусок, забирающий основное в своём бассейне.
      capture: p.weightCapture * (1 + ctx.spread),
      precision: p.weightPrecision,
      // «Естественной длине» тем больше доверия, чем больше людей выделяли.
      length: (p.weightLength * ctx.people) / (ctx.people + p.lengthPeople),
      // В коротком сообщении подсветить его почти целиком не страшно, в длинном — шум.
      coverage: (p.weightCoverage * ctx.textLength) / (ctx.textLength + p.slotChars),
    }),
    score: (f, w) =>
      Math.max(
        0,
        w.thickness * f.thickness +
          w.capture * f.capture +
          w.precision * f.precision +
          w.length * f.lengthFit -
          w.coverage * f.coverage,
      ),
  };
}

export type ModelBasin = {
  /** Диапазон бассейна, code points: от начала первого слова до конца последнего. */
  start: number;
  end: number;
  peakHeight: number;
  popularity: number;
  /** Что показывать; null — бассейн не отображается. */
  display: Range | null;
  /** Лучший по оценке вариант — на случай, если отображаемым придётся сделать его. */
  best: Range;
};

type Candidate = Range & {
  basin: number;
  features: CandidateFeatures;
  score: number;
  value: number;
};

type Valley = { at: number; peak: number; saddle: number; z: number; cut: boolean };

export type ModelDecision = {
  scorer: string;
  mapVersion: number;
  context: Record<string, number>;
  weights: Record<string, number>;
  valleys: Valley[];
  basins: {
    start: number;
    end: number;
    peakHeight: number;
    candidates: (Range & CandidateFeatures & { score: number; value: number })[];
  }[];
  selected: Range[];
};

export type ReliefResult = { basins: ModelBasin[]; decision: ModelDecision };

const round = (x: number) => Math.round(x * 1e4) / 1e4;

class UnionFind {
  parent: Int32Array;

  constructor(n: number) {
    this.parent = new Int32Array(n).fill(-1);
  }

  find(x: number): number {
    let r = x;

    while (this.parent[r] !== r) r = this.parent[r];

    while (this.parent[x] !== r) {
      const next = this.parent[x];

      this.parent[x] = r;
      x = next;
    }

    return r;
  }
}

/**
 * Ряд для спуска ватерлинии: у каждого слова две половины — левая (без
 * кусков, начинающихся на слове) и правая (без кончающихся), — между ними
 * внутренняя связь (куски, проходящие через слово или целиком на нём), между
 * словами — граница (`continuity`). Узлы — половины, связи — между ними;
 * связь не выше узлов по сторонам. Индекс: 4w — левая половина, 4w+1 —
 * внутренняя связь, 4w+2 — правая половина, 4w+3 — граница справа от слова.
 */
function fineRelief(map: HeightMap) {
  const { height: h, continuity: c, starts, ends } = map;
  const W = h.length;
  const E = Math.max(0, 4 * W - 1);
  const el = new Float64Array(E);

  for (let w = 0; w < W; w += 1) {
    const left = Math.max(0, h[w] - starts[w]);
    const right = Math.max(0, h[w] - ends[w]);

    el[4 * w] = left;
    el[4 * w + 2] = right;
    el[4 * w + 1] = Math.min(left, right, Math.max(0, h[w] - starts[w] - ends[w]));
  }

  for (let w = 0; w < W - 1; w += 1) el[4 * w + 3] = Math.min(c[w], el[4 * w + 2], el[4 * w + 4]);

  return el;
}

/**
 * Седловины: спуск ватерлинии union-find по убыванию высоты. Узел той же
 * высоты, что связь, идёт раньше неё — две горы встречаются всегда на связи.
 * z — без поправки на рябь (её считают по этим же седловинам).
 */
function findValleys(el: Float64Array, meanWeight: number) {
  const E = el.length;
  const isLink = (x: number) => x % 2 === 1;
  const order: number[] = [];

  for (let x = 0; x < E; x += 1) if (el[x] > 0) order.push(x);

  order.sort((a, b) => el[b] - el[a] || Number(isLink(a)) - Number(isLink(b)) || a - b);

  const uf = new UnionFind(E);
  const peakH = new Float64Array(E);
  const peakX = new Int32Array(E);
  const valleys: Valley[] = [];

  for (const x of order) {
    uf.parent[x] = x;
    peakH[x] = el[x];
    peakX[x] = x;

    let joined = false;

    for (const nb of [x - 1, x + 1]) {
      if (nb < 0 || nb >= E || uf.parent[nb] < 0) continue;

      const rx = uf.find(x);
      const rn = uf.find(nb);

      if (rx === rn) continue;

      if (!joined) {
        // Новая точка не выше вершины соседа — просто стекает к нему.
        uf.parent[rx] = rn;
        joined = true;
        continue;
      }

      // Седловина: две горы встречаются в x, младшая проверяется.
      const aWins = peakH[rx] > peakH[rn] || (peakH[rx] === peakH[rn] && peakX[rx] < peakX[rn]);
      const winner = aWins ? rx : rn;
      const loser = aWins ? rn : rx;
      const peak = peakH[loser];
      const saddle = el[x];

      if (peak > saddle) {
        valleys.push({
          at: x,
          peak,
          saddle,
          z: (peak - saddle) / Math.sqrt(meanWeight * (peak + saddle)),
          cut: false,
        });
      }

      uf.parent[loser] = winner;
    }
  }

  return valleys;
}

/** Рябь и разброс внимания — характеристики, выведенные из карты. */
function describeRelief(
  map: HeightMap,
  context: MessageContext,
  valleys: Valley[],
  p: ReliefParams,
): ScoringContext {
  const { height: h, words } = map;
  let positive = 0;
  let mass = 0;
  let first = 0;
  let second = 0;

  for (let w = 0; w < h.length; w += 1) {
    if (h[w] <= 0) continue;

    const center = (words[w].start + words[w].end) / 2;

    positive += 1;
    mass += h[w];
    first += h[w] * center;
    second += h[w] * center * center;
  }

  // Рябь — впадины, которые даже без поправки неотличимы от шума (z < 1).
  const ripples = valleys.filter((v) => v.z < 1).length;
  const noise = positive > 0 ? Math.min(1, ripples / positive) : 0;
  const mean = mass > 0 ? first / mass : 0;
  const variance = mass > 0 ? Math.max(0, second / mass - mean * mean) : 0;

  return {
    ...context,
    spread: context.textLength > 0 ? Math.sqrt(variance) / context.textLength : 0,
    noise,
    dispersion: 1 + p.noiseInflation * noise,
  };
}

/**
 * Разрезы между словами: связь нулевой высоты (никто через неё не идёт) или
 * значимая впадина. Разрез внутри слова отдаёт слово той половине, что выше.
 * `splitBefore[w]` — слово w начинает новый бассейн.
 */
function cutWords(
  el: Float64Array,
  valleys: Valley[],
  W: number,
  ctx: ScoringContext,
  p: ReliefParams,
) {
  const splitBefore = new Uint8Array(W);
  const cutAt = new Uint8Array(el.length);

  for (const v of valleys) {
    v.z /= Math.sqrt(ctx.dispersion);
    v.cut = v.z >= p.significanceZ;
    if (v.cut) cutAt[v.at] = 1;
  }

  for (let x = 1; x < el.length; x += 2) {
    if (!(cutAt[x] || (el[x] === 0 && el[x - 1] > 0 && el[x + 1] > 0))) continue;

    const w = x >> 2;

    if (x % 4 === 3) splitBefore[w + 1] = 1;
    else if (el[x - 1] >= el[x + 1]) {
      if (w + 1 < W) splitBefore[w + 1] = 1;
    } else splitBefore[w] = 1;
  }

  return splitBefore;
}

/** Варианты подсветки бассейна [bs, be]: ватерлиния опускается от вершины. */
function basinCandidates(
  map: HeightMap,
  ctx: ScoringContext,
  p: ReliefParams,
  basin: number,
  bs: number,
  be: number,
  prefix: Float64Array,
  shownBefore: Set<string>,
): { candidates: Omit<Candidate, 'score' | 'value'>[]; peak: number; peakHeight: number } {
  const { height: h, continuity: c, words } = map;
  let peak = bs;

  for (let w = bs + 1; w <= be; w += 1) if (h[w] > h[peak]) peak = w;

  const P = h[peak];
  const basinMass = prefix[be + 1] - prefix[bs];
  const edgeLevel = (a: number, b: number) =>
    Math.max(a > 0 ? c[a - 1] : 0, b < h.length - 1 ? c[b] : 0);
  const mu = ctx.pieceLogLengthMedian;
  const sigma = Math.max(p.lengthSpreadMin, ctx.pieceLogLengthSpread);

  const features = (
    a: number,
    b: number,
    range: Range,
    minInside: number,
    trimmed: boolean,
  ): CandidateFeatures => {
    const mass = prefix[b + 1] - prefix[a];
    const n = b - a + 1;
    const x = Math.log(n) - mu;

    return {
      thickness: P > 0 ? Math.max(0, minInside - edgeLevel(a, b)) / P : 0,
      capture: basinMass > 0 ? mass / basinMass : 0,
      precision: P > 0 ? mass / n / P : 0,
      lengthFit: Math.exp(-(x * x) / (2 * sigma * sigma)),
      coverage: ctx.textLength > 0 ? (range.end - range.start) / ctx.textLength : 0,
      shownBefore: shownBefore.has(`${range.start}:${range.end}`) ? 1 : 0,
      words: n,
      chars: range.end - range.start,
      trimmed: trimmed ? 1 : 0,
    };
  };

  const out: Omit<Candidate, 'score' | 'value'>[] = [];
  let L = peak;
  let R = peak;
  let level = P;

  for (;;) {
    const left = L > bs ? c[L - 1] : -1;
    const right = R < be ? c[R] : -1;
    const next = Math.max(left, right);

    if (next < level) {
      const range = { start: words[L].start, end: words[R].end };

      if (range.end - range.start <= p.maxDisplayLength) {
        out.push({ ...range, basin, features: features(L, R, range, level, false) });
      } else {
        if (out.length === 0) {
          // Верхнее плато длиннее лимита — рельеф над ним ровный: первые слова плато.
          const trimmed = roundToWords(range, words, p.maxDisplayLength)!;
          let b = L;

          while (b < R && words[b + 1].end <= trimmed.end) b += 1;

          out.push({ ...trimmed, basin, features: features(L, b, trimmed, level, true) });
        }

        break;
      }
    }

    if (next < 0) break;

    // Ватерлиния ниже — кусок прирастает словом с той стороны, где граница выше.
    if (left >= right) {
      L -= 1;
      level = Math.min(level, c[L], h[L]);
    } else {
      R += 1;
      level = Math.min(level, c[R - 1], h[R]);
    }
  }

  return { candidates: out, peak, peakHeight: P };
}

/**
 * Набор отображаемых без пересечений с наибольшей суммой ценностей: не больше
 * `slots`, каждый стоит `clutter`, соседний выбранный приглушает на
 * `densityPenalty · min(ценностей) · e^(−зазор / densityRadius)`.
 * Варианты одного бассейна вложены — в набор попадает не больше одного.
 */
function selectSet(candidates: Candidate[], slots: number, p: ReliefParams): number[] {
  const N = candidates.length;

  if (N === 0) return [];

  const order = candidates
    .map((_, i) => i)
    .sort(
      (a, b) =>
        candidates[a].end - candidates[b].end || candidates[a].start - candidates[b].start || a - b,
    );
  const cs = order.map((i) => candidates[i]);
  const ends = cs.map((x) => x.end);
  let vmax = 0;

  for (const x of cs) vmax = Math.max(vmax, x.value);

  const clutter = p.clutterCost * vmax;
  // Дальше этого зазора приглушение меньше 0.25% — считаем нулём.
  const reach = 6 * p.densityRadius;
  const upTo = (pos: number) => {
    let lo = 0;
    let hi = N;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;

      if (ends[mid] <= pos) lo = mid + 1;
      else hi = mid;
    }

    return lo;
  };
  const compatible = cs.map((x) => upTo(x.start));
  const far = cs.map((x) => upTo(x.start - reach));
  const penalty = (a: Candidate, b: Candidate) =>
    p.densityPenalty *
    Math.min(a.value, b.value) *
    Math.exp(-Math.max(0, b.start - a.end) / p.densityRadius);

  const dp: Float64Array[] = [];
  const back: Int32Array[] = [];
  let bestTotal = -Infinity;
  let bestK = -1;
  let bestI = -1;

  for (let k = 0; k < slots; k += 1) {
    const row = new Float64Array(N).fill(-Infinity);
    const from = new Int32Array(N).fill(-1);
    // Префиксный максимум прошлой строки — для далёких предшественников.
    const prefMax = new Float64Array(N + 1).fill(-Infinity);
    const prefArg = new Int32Array(N + 1).fill(-1);

    if (k > 0) {
      for (let j = 0; j < N; j += 1) {
        const better = dp[k - 1][j] > prefMax[j];

        prefMax[j + 1] = better ? dp[k - 1][j] : prefMax[j];
        prefArg[j + 1] = better ? j : prefArg[j];
      }
    }

    for (let i = 0; i < N; i += 1) {
      const own = cs[i].value - clutter;

      if (k === 0) {
        row[i] = own;
      } else {
        let best = prefMax[far[i]];
        let arg = prefArg[far[i]];

        for (let j = far[i]; j < compatible[i]; j += 1) {
          const v = dp[k - 1][j] - penalty(cs[j], cs[i]);

          if (v > best) {
            best = v;
            arg = j;
          }
        }

        if (arg >= 0) {
          row[i] = best + own;
          from[i] = arg;
        }
      }

      if (row[i] > bestTotal) {
        bestTotal = row[i];
        bestK = k;
        bestI = i;
      }
    }

    dp.push(row);
    back.push(from);
  }

  const picked: number[] = [];

  for (let k = bestK, i = bestI; k >= 0 && i >= 0; k -= 1) {
    picked.push(order[i]);
    i = back[k][i];
  }

  return picked;
}

export function computeRelief(
  map: HeightMap,
  context: MessageContext,
  params: Partial<ReliefParams> = {},
  scorer?: ScoringModel,
): ReliefResult {
  const p: ReliefParams = { ...DEFAULT_RELIEF_PARAMS, ...params };
  const model = scorer ?? linearScoringModel(p);
  const { height: h, continuity: c, words } = map;
  const W = h.length;
  const prefix = new Float64Array(W + 1);

  for (let w = 0; w < W; w += 1) prefix[w + 1] = prefix[w] + h[w];

  const el = fineRelief(map);
  const valleys = findValleys(el, context.meanWeight);
  const ctx = describeRelief(map, context, valleys, p);
  const weights = model.weights(ctx);
  const splitBefore = cutWords(el, valleys, W, ctx, p);
  const spans: [number, number][] = [];

  for (let w = 0; w < W; w += 1) {
    if (h[w] <= 0) continue;

    const last = spans[spans.length - 1];

    if (last && last[1] === w - 1 && c[w - 1] > 0 && !splitBefore[w]) last[1] = w;
    else spans.push([w, w]);
  }

  const shownBefore = new Set(context.previousDisplays.map((r) => `${r.start}:${r.end}`));
  const all: Candidate[] = [];
  const perBasin: Candidate[][] = [];
  const peaks: number[] = [];

  spans.forEach(([bs, be], basin) => {
    const { candidates, peakHeight } = basinCandidates(
      map,
      ctx,
      p,
      basin,
      bs,
      be,
      prefix,
      shownBefore,
    );
    const scored = candidates.map((x) => {
      const score = model.score(x.features, weights);

      return {
        ...x,
        score,
        value: peakHeight * score * (1 + p.stableBonus * x.features.shownBefore),
      };
    });

    peaks.push(peakHeight);
    perBasin.push(scored);
    all.push(...scored);
  });

  const slots = Math.min(
    Math.max(1, p.maxDisplayed),
    Math.max(1, Math.ceil(map.textLength / p.slotChars)),
  );
  const chosen = new Set(selectSet(all, slots, p));
  const displayOf = new Map<number, Candidate>();

  for (const i of chosen) displayOf.set(all[i].basin, all[i]);

  const basins: ModelBasin[] = spans.map(([bs, be], b) => {
    const best = perBasin[b].reduce((x, y) => (y.value > x.value ? y : x));
    const shown = displayOf.get(b) ?? null;
    const capture = (shown ?? best).features.capture;

    return {
      start: words[bs].start,
      end: words[be].end,
      peakHeight: peaks[b],
      popularity: Math.round(peaks[b] * (0.5 + 0.5 * capture) * 1e6) / 1e6,
      display: shown ? { start: shown.start, end: shown.end } : null,
      best: { start: best.start, end: best.end },
    };
  });

  const loggedBasins = spans
    .map((_, b) => b)
    .sort(
      (a, b) => Number(displayOf.has(b)) - Number(displayOf.has(a)) || peaks[b] - peaks[a] || a - b,
    )
    .slice(0, Math.max(p.decisionBasins, displayOf.size))
    .sort((a, b) => a - b);

  const decision: ModelDecision = {
    scorer: model.id,
    mapVersion: map.version,
    context: {
      textLength: ctx.textLength,
      wordCount: ctx.wordCount,
      people: ctx.people,
      pieces: ctx.pieces,
      pieceLogLengthMedian: round(ctx.pieceLogLengthMedian),
      pieceLogLengthSpread: round(ctx.pieceLogLengthSpread),
      meanWeight: round(ctx.meanWeight),
      spread: round(ctx.spread),
      noise: round(ctx.noise),
      dispersion: round(ctx.dispersion),
      slots,
      basins: spans.length,
    },
    weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, round(v)])),
    valleys: [...valleys]
      .sort((a, b) => b.peak - b.saddle - (a.peak - a.saddle) || a.at - b.at)
      .slice(0, p.decisionBasins)
      .map((v) => ({
        // Место впадины — в символах: граница между словами или середина слова.
        at:
          v.at % 4 === 3
            ? words[v.at >> 2].end
            : Math.floor((words[v.at >> 2].start + words[v.at >> 2].end) / 2),
        peak: round(v.peak),
        saddle: round(v.saddle),
        z: round(v.z),
        cut: v.cut,
      })),
    basins: loggedBasins.map((b) => ({
      start: basins[b].start,
      end: basins[b].end,
      peakHeight: round(peaks[b]),
      candidates: [...perBasin[b]]
        .sort((x, y) => y.value - x.value || x.start - y.start || x.end - y.end)
        .slice(0, p.decisionCandidates)
        .map((x) => ({
          start: x.start,
          end: x.end,
          ...(Object.fromEntries(
            Object.entries(x.features).map(([k, v]) => [k, round(v)]),
          ) as CandidateFeatures),
          score: round(x.score),
          value: round(x.value),
        })),
    })),
    selected: [...displayOf.values()]
      .map((x) => ({ start: x.start, end: x.end }))
      .sort((a, b) => a.start - b.start),
  };

  return { basins, decision };
}
