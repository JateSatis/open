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
 * Шаги:
 * 1. Склейка. Фрагменты, которые пересекаются или стоят ближе `mergeGap`
 *    символов, — один кластер (одиночная связь, проход по отсортированным).
 *    Длинный кластер режется в самом слабом месте — там, где его пересекает
 *    меньше всего фрагментов: цепочка разных кусков не сливается в одну
 *    заливку, а кусок, выделенный всеми целиком, остаётся целым.
 * 2. Два прохода. Первый кластеризует всё как есть. Во втором внутри каждого
 *    кластера первого прохода от человека остаётся один голос — его последний
 *    комментарий и его последняя реакция, — и по этим фрагментам кластеры
 *    строятся заново. Остальные фрагменты прикрепляются к кластеру второго
 *    прохода, с которым пересекаются больше (или к ближайшему).
 * 3. Популярность — по людям: каждый голосовавший даёт `weightPerson`, плюс
 *    `weightReaction` за реакцию и `weightComment · ln(1 + комментарии)`.
 * 4. Отображаемые — отдельный шаг: первые `maxDisplayLength` символов
 *    кластера, округлённые до слов, и жадный отбор без пересечений с
 *    динамическими весами (длина сообщения, покрытие, плотность соседей).
 * 5. Id кластера наследуется от прежнего с наибольшим пересечением по общим
 *    фрагментам, при равенстве — от старшего.
 */

export type ClusterParams = {
  /** Столько символов между фрагментами ещё склеивают их в один кластер. */
  mergeGap: number;
  /** Кластер длиннее этого пробуют разрезать в слабом месте. */
  splitLength: number;
  /** Режем, если место разреза пересекает не больше этой доли фрагментов кластера. */
  splitCrossShare: number;
  weightPerson: number;
  weightReaction: number;
  weightComment: number;
  maxDisplayLength: number;
  /** Одно отображаемое место на столько символов сообщения. */
  slotChars: number;
  maxDisplayed: number;
  /** Отображаемые вместе покрывают не больше этой доли текста (кроме первого). */
  maxCoverageShare: number;
  /** Менее популярные, чем эта доля от самого популярного, не показываются. */
  minRelativePopularity: number;
  /** Насколько выбранный кластер приглушает соседей вплотную (0..1). */
  densityPenalty: number;
  /** На каком расстоянии приглушение спадает в e раз, символов. */
  densityRadius: number;
};

export const DEFAULT_CLUSTER_PARAMS: ClusterParams = {
  mergeGap: 2,
  splitLength: 200,
  splitCrossShare: 0.34,
  weightPerson: 1,
  weightReaction: 0.5,
  weightComment: 1.5,
  maxDisplayLength: 200,
  slotChars: 100,
  maxDisplayed: 8,
  maxCoverageShare: 0.5,
  minRelativePopularity: 0.15,
  densityPenalty: 0.6,
  densityRadius: 120,
};

export type Range = { start: number; end: number };

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

export type PreviousCluster = { id: string; start: number; end: number; createdAt: number };

export type ClusterModelInput = {
  text: string;
  fragments: FragmentInput[];
  votes: VoteInput[];
  previous?: PreviousCluster[];
  params?: Partial<ClusterParams>;
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

export type ClusterModelResult = { clusters: ModelCluster[] };

type Vote = { person: string; kind: 'reaction' | 'comment'; at: number; frag: number };

type Frag = { id: string; start: number; end: number; clusterId: string | null; votes: Vote[] };

type Group = { start: number; end: number; members: number[] };

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Доля фрагментов кластера, которая должна остаться целиком с каждой стороны разреза. */
const MIN_SIDE_SHARE = 0.1;

// =============================================================================
// Слова
// =============================================================================

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
function firstWordEndingAfter(words: Range[], pos: number): number {
  let lo = 0;
  let hi = words.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (words[mid].end > pos) hi = mid;
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

// =============================================================================
// Склейка и разрез
// =============================================================================

function clip(f: Frag, lo: number, hi: number): Range {
  return { start: Math.max(f.start, lo), end: Math.min(f.end, hi) };
}

/** Одиночная связь: `members` отсортированы по началу. */
function link(members: number[], frags: Frag[], lo: number, hi: number, gap: number): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;

  for (const i of members) {
    const r = clip(frags[i], lo, hi);

    if (r.end <= r.start) continue;

    if (current && r.start - current.end <= gap) {
      if (r.end > current.end) current.end = r.end;
      current.members.push(i);
    } else {
      current = { start: r.start, end: r.end, members: [i] };
      groups.push(current);
    }
  }

  return groups;
}

/**
 * Место разреза длинного кластера: точка, которую пересекает меньше всего
 * фрагментов, при равенстве — ближе к середине. С каждой стороны должна
 * остаться заметная доля фрагментов целиком (`MIN_SIDE_SHARE`, хотя бы один):
 * иначе разрез откусывает по краю, а не делит, и резать пришлось бы столько
 * раз, сколько фрагментов. Слабого места нет — null.
 */
function findCut(piece: Group, frags: Frag[], p: ClusterParams): number | null {
  const lo = piece.start;
  const hi = piece.end;
  const span = hi - lo;

  if (span <= p.splitLength || piece.members.length < 2) return null;

  const diff = new Int32Array(span + 1);
  const endsAt = new Int32Array(span + 1);
  const startsAt = new Int32Array(span + 1);

  for (const i of piece.members) {
    const r = clip(frags[i], lo, hi);

    endsAt[r.end - lo] += 1;
    startsAt[r.start - lo] += 1;

    if (r.end - r.start >= 2) {
      diff[r.start + 1 - lo] += 1;
      diff[r.end - lo] -= 1;
    }
  }

  const minSide = Math.max(1, Math.floor(MIN_SIDE_SHARE * piece.members.length));
  // Справа целиком — те, что начинаются не левее x: идём с конца.
  const rightWhole = new Int32Array(span + 2);

  for (let x = span; x >= 0; x -= 1) rightWhole[x] = rightWhole[x + 1] + startsAt[x];

  let run = 0;
  let leftWhole = 0;
  let best = -1;
  let bestCross = Infinity;
  let bestDistance = Infinity;

  for (let x = lo; x < hi; x += 1) {
    run += diff[x - lo];
    leftWhole += endsAt[x - lo];

    if (leftWhole < minSide) continue;
    if (rightWhole[x - lo] < minSide) break;

    const distance = Math.abs(2 * x - lo - hi);

    if (run < bestCross || (run === bestCross && distance < bestDistance)) {
      best = x;
      bestCross = run;
      bestDistance = distance;
    }
  }

  return best >= 0 && bestCross <= p.splitCrossShare * piece.members.length ? best : null;
}

function divide(piece: Group, x: number, frags: Frag[]): [Group, Group] {
  const left: Group = { start: Infinity, end: -Infinity, members: [] };
  const right: Group = { start: Infinity, end: -Infinity, members: [] };

  for (const i of piece.members) {
    const r = clip(frags[i], piece.start, piece.end);
    const leftPart = Math.min(r.end, x) - r.start;
    const rightPart = r.end - Math.max(r.start, x);
    const side = leftPart >= rightPart ? left : right;

    side.members.push(i);
    if (r.start < side.start) side.start = r.start;
    if (r.end > side.end) side.end = r.end;
  }

  left.end = Math.min(left.end, x);
  right.start = Math.max(right.start, x);

  return [left, right];
}

function split(group: Group, frags: Frag[], p: ClusterParams): Group[] {
  const out: Group[] = [];
  const stack = [group];

  while (stack.length > 0) {
    const piece = stack.pop()!;
    const x = findCut(piece, frags, p);

    if (x === null) {
      out.push(piece);
      continue;
    }

    const [left, right] = divide(piece, x, frags);

    stack.push(right, left);
  }

  return out.sort((a, b) => a.start - b.start);
}

function clusterize(members: number[], frags: Frag[], lo: number, hi: number, p: ClusterParams) {
  return link(members, frags, lo, hi, p.mergeGap).flatMap((g) => split(g, frags, p));
}

// =============================================================================
// Прикрепление отброшенных вторым проходом фрагментов
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

      for (let i = 0; i < row.length; i += 1) row[i] = this.better(prev[i], prev[i + (1 << (k - 1))]);

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

/** Кластер для фрагмента: наибольшее пересечение, при равенстве левый; без пересечений — ближайший. */
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
    const overlap = (g: Group) => Math.min(r.end, g.end) - Math.max(r.start, g.start);
    let best = i;
    let bestOverlap = overlap(groups[i]);

    if (j - i >= 2) {
      const inner = query.longest(i + 1, j - 1);
      const innerOverlap = overlap(groups[inner]);

      if (innerOverlap > bestOverlap) {
        best = inner;
        bestOverlap = innerOverlap;
      }
    }

    if (j > i && overlap(groups[j]) > bestOverlap) best = j;

    return best;
  }

  // Пересечений нет: i — первый справа, i - 1 — последний слева.
  if (i >= groups.length) return groups.length - 1;
  if (i === 0) return 0;

  return r.start - groups[i - 1].end <= groups[i].start - r.end ? i - 1 : i;
}

// =============================================================================
// Модель
// =============================================================================

function prepare(input: ClusterModelInput, length: number) {
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

  const raw = input.votes
    .filter((v) => index.has(v.fragmentId))
    .map((v) => ({ ...v, frag: index.get(v.fragmentId)! }))
    .sort(
      (a, b) =>
        a.frag - b.frag ||
        cmpStr(a.kind, b.kind) ||
        cmpStr(a.userId ?? '', b.userId ?? '') ||
        a.at - b.at,
    );

  raw.forEach((v, n) => {
    frags[v.frag].votes.push({
      // Удалённый аккаунт — отдельный человек на каждый голос.
      person: v.userId ?? `\u0000${n}`,
      kind: v.kind,
      at: v.at,
      frag: v.frag,
    });
  });

  return frags;
}

/** От каждого человека — его последняя реакция и его последний комментарий. */
function oneVoicePerPerson(group: Group, frags: Frag[]): number[] {
  const latest = new Map<string, Vote>();

  for (const i of group.members) {
    for (const v of frags[i].votes) {
      const key = `${v.kind}\u0000${v.person}`;
      const seen = latest.get(key);

      if (!seen || v.at > seen.at || (v.at === seen.at && v.frag > seen.frag)) latest.set(key, v);
    }
  }

  return [...new Set([...latest.values()].map((v) => v.frag))].sort((a, b) => a - b);
}

function secondPass(group: Group, frags: Frag[], p: ClusterParams): Group[] {
  const kept = oneVoicePerPerson(group, frags);

  if (kept.length === 0) return [group];

  const groups = clusterize(kept, frags, group.start, group.end, p);
  const inCore = new Set<number>();

  for (const g of groups) for (const i of g.members) inCore.add(i);

  const query = new LongestQuery(groups.map((g) => g.end - g.start));

  for (const i of group.members) {
    if (inCore.has(i)) continue;

    const r = clip(frags[i], group.start, group.end);

    groups[attachTarget(r, groups, query)].members.push(i);
  }

  for (const g of groups) g.members.sort((a, b) => a - b);

  return groups;
}

function popularity(group: Group, frags: Frag[], p: ClusterParams) {
  const people = new Map<string, { reaction: boolean; comments: number }>();

  for (const i of group.members) {
    for (const v of frags[i].votes) {
      const person = people.get(v.person) ?? { reaction: false, comments: 0 };

      if (v.kind === 'reaction') person.reaction = true;
      else person.comments += 1;

      people.set(v.person, person);
    }
  }

  let score = 0;

  for (const person of people.values()) {
    score +=
      p.weightPerson +
      (person.reaction ? p.weightReaction : 0) +
      p.weightComment * Math.log1p(person.comments);
  }

  return { score, people: people.size };
}

function gapBetween(a: Range, b: Range): number {
  return Math.max(0, Math.max(a.start, b.start) - Math.min(a.end, b.end));
}

/**
 * Отображаемые: жадно по убыванию веса. Вес — популярность; каждый выбранный
 * приглушает соседей тем сильнее, чем ближе они к нему, — в редком месте
 * пройдёт менее популярный кластер, чем в густом. Сколько показывать —
 * от длины сообщения, сколько текста закрыть — от доли покрытия.
 */
function selectDisplayed(
  candidates: { display: Range; popularity: number; index: number }[],
  length: number,
  p: ClusterParams,
): Set<number> {
  const chosen: Range[] = [];
  const picked = new Set<number>();

  if (candidates.length === 0) return picked;

  const weight = candidates.map((c) => c.popularity);
  const alive = candidates.map(() => true);
  const top = Math.max(...weight);
  const floor = top > 0 ? p.minRelativePopularity * top : -Infinity;
  const maxCount = Math.min(Math.max(1, Math.ceil(length / p.slotChars)), Math.max(1, p.maxDisplayed));
  const budget = p.maxCoverageShare * length;
  let covered = 0;

  while (chosen.length < maxCount) {
    let best = -1;

    for (let i = 0; i < candidates.length; i += 1) {
      if (!alive[i]) continue;

      const c = candidates[i];
      const size = c.display.end - c.display.start;

      if (chosen.length > 0 && (weight[i] < floor || covered + size > budget)) continue;

      if (
        best < 0 ||
        weight[i] > weight[best] ||
        (weight[i] === weight[best] &&
          (c.popularity > candidates[best].popularity ||
            (c.popularity === candidates[best].popularity && c.display.start < candidates[best].display.start)))
      ) {
        best = i;
      }
    }

    if (best < 0) break;

    const range = candidates[best].display;

    chosen.push(range);
    picked.add(candidates[best].index);
    alive[best] = false;
    covered += range.end - range.start;

    for (let i = 0; i < candidates.length; i += 1) {
      if (!alive[i]) continue;

      const other = candidates[i].display;

      if (other.start < range.end && range.start < other.end) {
        alive[i] = false;
        continue;
      }

      weight[i] *= 1 - p.densityPenalty * Math.exp(-gapBetween(range, other) / p.densityRadius);
    }
  }

  return picked;
}

/**
 * Id наследуется от прежнего кластера с наибольшим пересечением по общим
 * фрагментам (правка текста сдвигает диапазоны, но не состав); при равенстве
 * — от старшего, потом по пересечению символов (прежний кластер, чьи
 * фрагменты все уснули). Один прежний id — одному новому.
 */
function inheritIds(groups: Group[], frags: Frag[], previous: PreviousCluster[]): (string | null)[] {
  const old = [...previous].sort((a, b) => a.start - b.start || a.end - b.end || cmpStr(a.id, b.id));
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

export function computeClusters(input: ClusterModelInput): ClusterModelResult {
  const p: ClusterParams = { ...DEFAULT_CLUSTER_PARAMS, ...input.params };
  const length = Array.from(input.text).length;
  const words = wordSpans(input.text);
  const frags = prepare(input, length);
  const all = frags.map((_, i) => i);

  const firstPass = clusterize(all, frags, 0, length, p);
  const groups = firstPass.flatMap((g) => secondPass(g, frags, p));
  const ids = inheritIds(groups, frags, input.previous ?? []);

  const scored = groups.map((g) => ({ ...popularity(g, frags, p), display: roundToWords(g, words, p.maxDisplayLength) }));

  const shown = selectDisplayed(
    scored.flatMap((s, index) => (s.display ? [{ display: s.display, popularity: s.score, index }] : [])),
    length,
    p,
  );

  return {
    clusters: groups.map((g, i) => ({
      id: ids[i],
      start: g.start,
      end: g.end,
      fragmentIds: g.members.map((m) => frags[m].id),
      popularity: Math.round(scored[i].score * 1e6) / 1e6,
      people: scored[i].people,
      display: shown.has(i) ? scored[i].display : null,
    })),
  };
}
