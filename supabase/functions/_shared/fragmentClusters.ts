/**
 * Модель кластеров выделенных фрагментов текста сообщения.
 *
 * Чистая функция «вход → результат»: ни базы, ни сети, ни часов. Обработчик
 * очереди (сейчас — Edge Function `fragment-clusters`, позже — отдельный
 * сервис) читает снимок сообщения, зовёт `computeClusters` и пишет результат.
 * Одинаковый вход даёт одинаковый результат при любом порядке элементов.
 *
 * Смещения — code points, полуоткрытые `[start, end)`, как в базе.
 *
 * Слои:
 * 1. Адаптер (`popularityMap.ts`): фрагменты и голоса → карта популярности
 *    по словам + характеристики сообщения. Здесь кончаются фрагменты.
 * 2. Модель рельефа (`reliefModel.ts`): карта → бассейны (кластеры) и что
 *    в них отображать. О фрагментах не знает.
 * 3. Привязка: фрагмент → бассейн с наибольшим пересечением (при равенстве —
 *    левее), без пересечений — ближайший. Бассейн, которому не досталось ни
 *    одного фрагмента, забирает фрагмент с наибольшим пересечением у соседа,
 *    где их больше одного; не вышло — бассейн не становится кластером.
 * 4. Id кластера наследуется от прежнего с наибольшим пересечением по общим
 *    фрагментам, при равенстве — от старшего.
 */

import {
  buildHeightMap,
  type HeightMap,
  type MessageContext,
  type PersonPiece,
} from './popularityMap.ts';
import {
  computeRelief,
  DEFAULT_RELIEF_PARAMS,
  type ModelBasin,
  type ModelDecision,
  type ReliefParams,
  type ScoringModel,
} from './reliefModel.ts';
import { roundToWords, wordSpans, type Range } from './textWords.ts';

export { roundToWords, wordSpans, type Range } from './textWords.ts';
export type { HeightMap, MessageContext } from './popularityMap.ts';
export type { ModelDecision, ScoringModel } from './reliefModel.ts';

export type ClusterParams = ReliefParams & {
  /** Вес слоя человека в точке, где у него только реакция. */
  weightReaction: number;
  /** Вес слоя, где у него комментарий. Больше реакции. */
  weightComment: number;
};

export const DEFAULT_CLUSTER_PARAMS: ClusterParams = {
  ...DEFAULT_RELIEF_PARAMS,
  weightReaction: 1,
  weightComment: 1.5,
};

export type FragmentInput = {
  id: string;
  start: number;
  end: number;
  /** Кластер фрагмента до пересчёта — по нему наследуются id. */
  clusterId?: string | null;
};

export type VoteInput = {
  fragmentId: string;
  /** null — аккаунт удалён: такой голос считается отдельным человеком. */
  userId: string | null;
  kind: 'reaction' | 'comment';
  /** Время голоса, мс. Для реакции — когда её поставили или сменили. */
  at: number;
};

export type PreviousCluster = {
  id: string;
  start: number;
  end: number;
  createdAt: number;
  /** Что было отображено; нет — не отображался. */
  displayStart?: number | null;
  displayEnd?: number | null;
};

export type ClusterModelInput = {
  text: string;
  fragments: FragmentInput[];
  votes: VoteInput[];
  previous?: PreviousCluster[];
  params?: Partial<ClusterParams>;
  /** Функция оценки вариантов; по умолчанию — линейная со стартовыми коэффициентами. */
  scorer?: ScoringModel;
};

export type ModelCluster = {
  /** Унаследованный id или null — новый кластер. */
  id: string | null;
  start: number;
  end: number;
  fragmentIds: string[];
  popularity: number;
  people: number;
  /** Что показывать на тексте; null — кластер не отображается. */
  display: Range | null;
};

export type ClusterModelResult = { clusters: ModelCluster[]; decision?: ModelDecision | null };

/** `person` — номер в `Prepared.people`. */
type Vote = { person: number; kind: 'reaction' | 'comment'; at: number; frag: number };

type Frag = { id: string; start: number; end: number; clusterId: string | null; votes: Vote[] };

type Prepared = { frags: Frag[]; people: string[] };

type Group = { start: number; end: number; members: number[]; basin: ModelBasin | null };

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// =============================================================================
// Вход
// =============================================================================

function prepare(input: ClusterModelInput, length: number): Prepared {
  const frags: Frag[] = input.fragments
    .filter((f) => Number.isInteger(f.start) && Number.isInteger(f.end))
    .map((f) => ({
      id: f.id,
      start: Math.max(0, f.start),
      end: Math.min(length, f.end),
      clusterId: f.clusterId ?? null,
      votes: [] as Vote[],
    }))
    .filter((f) => f.end > f.start)
    .sort((a, b) => a.start - b.start || a.end - b.end || cmpStr(a.id, b.id));

  const index = new Map<string, number>();

  frags.forEach((f, i) => index.set(f.id, i));

  // Удалённый аккаунт — отдельный человек на каждый голос. Ключ — из самого
  // голоса, а не из порядка входа: одинаковые голоса неразличимы.
  const seen = new Map<string, number>();
  const personIndex = new Map<string, number>();
  const people: string[] = [];

  for (const v of input.votes) {
    const frag = index.get(v.fragmentId);

    if (frag === undefined) continue;

    let person = v.userId;

    if (person === null) {
      const key = `\u0000${frag}:${v.kind}:${v.at}`;
      const k = seen.get(key) ?? 0;

      seen.set(key, k + 1);
      person = `${key}:${k}`;
    }

    let n = personIndex.get(person);

    if (n === undefined) {
      n = people.length;
      personIndex.set(person, n);
      people.push(person);
    }

    frags[frag].votes.push({ person: n, kind: v.kind, at: v.at, frag });
  }

  return { frags, people };
}

/** Куски людей для карты: каждый голос — кусок с весом своего вида; максимум возьмёт карта. */
function personPieces(frags: Frag[], people: string[], p: ClusterParams): PersonPiece[][] {
  const byPerson: PersonPiece[][] = people.map(() => []);

  for (const f of frags) {
    for (const v of f.votes) {
      const piece = {
        start: f.start,
        end: f.end,
        weight: v.kind === 'comment' ? p.weightComment : p.weightReaction,
      };
      byPerson[v.person].push(piece);
    }
  }

  // Порядок людей — по ключу: сумма слоёв не зависит от порядка входа.
  return people
    .map((key, i) => ({ key, i }))
    .sort((a, b) => cmpStr(a.key, b.key))
    .map(({ i }) => byPerson[i]);
}

// =============================================================================
// Привязка фрагментов к бассейнам
// =============================================================================

/** Индекс самого длинного кластера на отрезке [i, j] за O(1), при равенстве — левого. */
class LongestQuery {
  private table: Int32Array[];

  constructor(private lengths: number[]) {
    const n = lengths.length;
    this.table = [Int32Array.from({ length: n }, (_, i) => i)];

    for (let k = 1; 1 << k <= n; k += 1) {
      const prev = this.table[k - 1];
      const row = new Int32Array(n - (1 << k) + 1);

      for (let i = 0; i < row.length; i += 1)
        row[i] = this.better(prev[i], prev[i + (1 << (k - 1))]);

      this.table.push(row);
    }
  }

  private better(a: number, b: number) {
    return this.lengths[b] > this.lengths[a] ? b : a;
  }

  longest(i: number, j: number): number {
    const k = 31 - Math.clz32(j - i + 1);

    return this.better(this.table[k][i], this.table[k][j - (1 << k) + 1]);
  }
}

const overlapOf = (r: Range, g: Range) => Math.min(r.end, g.end) - Math.max(r.start, g.start);

/** Бассейн для фрагмента: наибольшее пересечение, при равенстве левый; без пересечений — ближайший. */
function attachTarget(r: Range, groups: Group[], query: LongestQuery): number {
  let lo = 0;
  let hi = groups.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (groups[mid].end > r.start) hi = mid;
    else lo = mid + 1;
  }

  const i = lo;

  hi = groups.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (groups[mid].start < r.end) lo = mid + 1;
    else hi = mid;
  }

  const j = lo - 1;

  if (i <= j) {
    let best = i;
    let bestOverlap = overlapOf(r, groups[i]);

    // Бассейны не пересекаются: внутренние покрыты фрагментом целиком.
    if (j - i >= 2) {
      const inner = query.longest(i + 1, j - 1);
      const innerOverlap = overlapOf(r, groups[inner]);

      if (innerOverlap > bestOverlap) {
        best = inner;
        bestOverlap = innerOverlap;
      }
    }

    if (j > i && overlapOf(r, groups[j]) > bestOverlap) best = j;

    return best;
  }

  // Пересечений нет: i — первый справа, i - 1 — последний слева.
  if (i >= groups.length) return groups.length - 1;
  if (i === 0) return 0;

  return r.start - groups[i - 1].end <= groups[i].start - r.end ? i - 1 : i;
}

function attach(frags: Frag[], groups: Group[]): Group[] {
  const query = new LongestQuery(groups.map((g) => g.end - g.start));
  const owner = new Int32Array(frags.length);

  frags.forEach((f, i) => {
    owner[i] = attachTarget(f, groups, query);
    groups[owner[i]].members.push(i);
  });

  // Бассейн без фрагментов: его высоту дали фрагменты, которые больше
  // пересекаются с соседями. Забираем у соседа, где фрагментов больше одного,
  // самый пересекающийся — иначе подсветку нечем было бы открыть.
  groups.forEach((g, gi) => {
    if (g.members.length > 0) return;

    let best = -1;
    let bestOverlap = 0;

    for (let i = 0; i < frags.length && frags[i].start < g.end; i += 1) {
      const overlap = overlapOf(frags[i], g);

      if (overlap > bestOverlap && groups[owner[i]].members.length > 1) {
        best = i;
        bestOverlap = overlap;
      }
    }

    if (best < 0) return;

    const from = groups[owner[best]];

    from.members.splice(from.members.indexOf(best), 1);
    owner[best] = gi;
    g.members.push(best);
  });

  for (const g of groups) g.members.sort((a, b) => a - b);

  return groups.filter((g) => g.members.length > 0);
}

// =============================================================================
// Id
// =============================================================================

/**
 * Id наследуется от прежнего кластера с наибольшим пересечением по общим
 * фрагментам (правка текста сдвигает диапазоны, но не состав); при равенстве
 * — от старшего, потом по пересечению символов (прежний кластер, чьи
 * фрагменты все уснули). Один прежний id — одному новому.
 */
function inheritIds(
  groups: Group[],
  frags: Frag[],
  previous: PreviousCluster[],
): (string | null)[] {
  const old = [...previous].sort(
    (a, b) => a.start - b.start || a.end - b.end || cmpStr(a.id, b.id),
  );
  const oldIndex = new Map(old.map((o, i) => [o.id, i]));
  const pairs = new Map<number, { g: number; o: number; shared: number; overlap: number }>();
  const pair = (g: number, o: number) => {
    const key = g * old.length + o;
    let found = pairs.get(key);

    if (!found) {
      found = { g, o, shared: 0, overlap: 0 };
      pairs.set(key, found);
    }

    return found;
  };

  groups.forEach((group, g) => {
    for (const m of group.members) {
      const o = frags[m].clusterId === null ? undefined : oldIndex.get(frags[m].clusterId);

      if (o !== undefined) pair(g, o).shared += 1;
    }
  });

  let from = 0;

  for (let g = 0; g < groups.length; g += 1) {
    while (from < old.length && old[from].end <= groups[g].start) from += 1;

    for (let o = from; o < old.length && old[o].start < groups[g].end; o += 1) {
      const overlap = Math.min(groups[g].end, old[o].end) - Math.max(groups[g].start, old[o].start);

      if (overlap > 0) pair(g, o).overlap = overlap;
    }
  }

  const ranked = [...pairs.values()].sort(
    (a, b) =>
      b.shared - a.shared ||
      old[a.o].createdAt - old[b.o].createdAt ||
      b.overlap - a.overlap ||
      cmpStr(old[a.o].id, old[b.o].id) ||
      a.g - b.g,
  );

  const ids: (string | null)[] = groups.map(() => null);
  const used = new Set<number>();

  for (const p of ranked) {
    if (ids[p.g] !== null || used.has(p.o)) continue;

    ids[p.g] = old[p.o].id;
    used.add(p.o);
  }

  return ids;
}

// =============================================================================
// Модель
// =============================================================================

function peopleOf(group: Group, frags: Frag[]): number {
  const people = new Set<number>();

  for (const i of group.members) for (const v of frags[i].votes) people.add(v.person);

  return people.size;
}

function mapOf(
  input: ClusterModelInput,
  p: ClusterParams,
  length: number,
  words: Range[],
  prepared: Prepared,
) {
  const previousDisplays = (input.previous ?? [])
    .filter((c) => Number.isInteger(c.displayStart) && Number.isInteger(c.displayEnd))
    .map((c) => ({ start: c.displayStart!, end: c.displayEnd! }));

  return buildHeightMap(
    length,
    words,
    personPieces(prepared.frags, prepared.people, p),
    previousDisplays,
  );
}

/** Вход модели рельефа — карта и характеристики сообщения — без самой модели. */
export function heightMapOf(input: ClusterModelInput): { map: HeightMap; context: MessageContext } {
  const p: ClusterParams = { ...DEFAULT_CLUSTER_PARAMS, ...input.params };
  const length = Array.from(input.text).length;
  const words = wordSpans(input.text);

  return mapOf(input, p, length, words, prepare(input, length));
}

export function computeClusters(input: ClusterModelInput): ClusterModelResult {
  const p: ClusterParams = { ...DEFAULT_CLUSTER_PARAMS, ...input.params };
  const length = Array.from(input.text).length;
  const words = wordSpans(input.text);
  const prepared = prepare(input, length);
  const { frags } = prepared;

  if (frags.length === 0) return { clusters: [], decision: null };

  const { map, context } = mapOf(input, p, length, words, prepared);
  const relief = computeRelief(map, context, p, input.scorer);

  let groups: Group[] = relief.basins.map((b) => ({
    start: b.start,
    end: b.end,
    members: [],
    basin: b,
  }));

  if (groups.length === 0) {
    // Фрагменты только в пробелах: горы нет — кластер вокруг ближайшего слова.
    const display = roundToWords(frags[0], words, p.maxDisplayLength);
    const range = display ?? { start: frags[0].start, end: frags[0].end };

    groups = [
      {
        ...range,
        members: [],
        basin: display ? { ...range, peakHeight: 0, popularity: 0, display, best: display } : null,
      },
    ];
  }

  groups = attach(frags, groups);

  // Отображаемый бассейн остался без фрагментов — показать лучший из оставшихся.
  if (!groups.some((g) => g.basin?.display) && groups.length > 0) {
    const top = groups.reduce((x, y) =>
      (y.basin?.popularity ?? 0) > (x.basin?.popularity ?? 0) ? y : x,
    );

    if (top.basin) top.basin = { ...top.basin, display: top.basin.best };
  }

  const ids = inheritIds(groups, frags, input.previous ?? []);
  const clusters = groups.map((g, i) => ({
    id: ids[i],
    start: g.start,
    end: g.end,
    fragmentIds: g.members.map((m) => frags[m].id),
    popularity: g.basin?.popularity ?? 0,
    people: peopleOf(g, frags),
    display: g.basin?.display ?? null,
  }));

  return {
    clusters,
    decision: {
      ...relief.decision,
      selected: clusters.flatMap((c) => (c.display ? [c.display] : [])),
    },
  };
}
