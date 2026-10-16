// Эталонные сценарии модели кластеров. Запуск: npm run test:functions.

import { assert, assertEquals } from 'jsr:@std/assert@1';

import {
  computeClusters,
  heightMapOf,
  roundToWords,
  wordSpans,
  type ClusterModelInput,
  type FragmentInput,
  type ModelCluster,
  type PreviousCluster,
  type Range,
  type VoteInput,
} from './fragmentClusters.ts';
import { computeRelief } from './reliefModel.ts';

type Spec = [id: string, start: number, end: number, votes: [user: string | null, kind: 'r' | 'c', at: number][]];

function input(text: string, specs: Spec[], extra: Partial<ClusterModelInput> = {}): ClusterModelInput {
  const fragments: FragmentInput[] = specs.map(([id, start, end]) => ({ id, start, end }));
  const votes: VoteInput[] = specs.flatMap(([id, , , vs]) =>
    vs.map(([userId, kind, at]) => ({ fragmentId: id, userId, kind: kind === 'r' ? 'reaction' : 'comment', at })),
  );

  return { text, fragments, votes, ...extra };
}

/** `n` людей с префиксом `who`, каждый — свой фрагмент на `[start, end)`. */
function crowd(who: string, n: number, start: number, end: number, kind: 'r' | 'c' = 'r'): Spec[] {
  return Array.from({ length: n }, (_, i) => [`${who}${i}:${start}-${end}`, start, end, [[`${who}${i}`, kind, i]]]);
}

/** Диапазон слов `[a, b]` текста в code points. */
function wordsRange(text: string, a: number, b: number): [number, number] {
  const w = wordSpans(text);

  return [w[a].start, w[b].end];
}

const shown = (clusters: ModelCluster[]) => clusters.filter((c) => c.display);

const slice = (text: string, r: Range) => Array.from(text).slice(r.start, r.end).join('');

const shownTexts = (text: string, clusters: ModelCluster[]) =>
  shown(clusters)
    .map((c) => c.display!)
    .sort((a, b) => a.start - b.start)
    .map((r) => slice(text, r));

const words = (n: number, word = 'слово') => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');

/** Прежнее состояние из результата — как его отдал бы снимок базы. */
function previousOf(clusters: ModelCluster[]): PreviousCluster[] {
  return clusters.map((c, i) => ({
    id: c.id ?? `K${i}`,
    start: c.start,
    end: c.end,
    createdAt: i,
    displayStart: c.display?.start ?? null,
    displayEnd: c.display?.end ?? null,
  }));
}

/** Инварианты отображаемых, которые держатся на любом входе. */
function assertDisplayInvariants(text: string, clusters: ModelCluster[], hasFragments: boolean) {
  const spans = wordSpans(text);
  const starts = new Set(spans.map((w) => w.start));
  const ends = new Set(spans.map((w) => w.end));
  const displayed = shown(clusters)
    .map((c) => c.display!)
    .sort((a, b) => a.start - b.start);

  if (hasFragments && spans.length > 0) assert(displayed.length >= 1, 'хотя бы один отображаемый');

  for (let i = 0; i < displayed.length; i += 1) {
    const d = displayed[i];

    assert(d.end - d.start <= 200, `длина ${d.end - d.start} > 200`);
    if (i > 0) assert(displayed[i - 1].end <= d.start, 'отображаемые пересекаются');

    const longWord = spans.find((w) => w.start === d.start && w.end - w.start > 200);

    assert(starts.has(d.start), `начало ${d.start} не на границе слова`);
    assert(longWord || ends.has(d.end), `конец ${d.end} не на границе слова`);
    assert(
      longWord || spans.some((w) => w.start >= d.start && w.end <= d.end),
      'отображаемый не содержит целого слова',
    );
  }
}

// =============================================================================
// Слова и округление
// =============================================================================

Deno.test('слова: кириллица, эмодзи, переносы строк, пунктуация прилипает', () => {
  const text = 'Привет, мир!\nЭто 🔥 — огонь…  ок';

  assertEquals(
    wordSpans(text).map((w) => slice(text, w)),
    ['Привет,', 'мир!', 'Это', '🔥', '—', 'огонь…', 'ок'],
  );
});

Deno.test('слова: эмодзи из нескольких code points — смещения в code points', () => {
  const text = '👍🏽 да';

  assertEquals(wordSpans(text), [
    { start: 0, end: 2 },
    { start: 3, end: 5 },
  ]);
});

Deno.test('округление: слово входит, если внутри не меньше половины', () => {
  const text = 'abcdefgh ijklmnop';
  const w = wordSpans(text);

  // Внутри 4 из 8 букв второго слова — половина, входит.
  assertEquals(roundToWords({ start: 2, end: 13 }, w, 200), { start: 0, end: 17 });
  // 3 из 8 — меньше половины, не входит; первое — 6 из 8, входит.
  assertEquals(roundToWords({ start: 2, end: 12 }, w, 200), { start: 0, end: 8 });
  // У первого 3 из 8 — не входит.
  assertEquals(roundToWords({ start: 5, end: 17 }, w, 200), { start: 9, end: 17 });
});

Deno.test('округление: меньше половины любого слова — всё равно одно слово', () => {
  const w = wordSpans('abcdefgh ijklmnop');

  assertEquals(roundToWords({ start: 1, end: 2 }, w, 200), { start: 0, end: 8 });
  // Поровну двух слов — левое.
  assertEquals(roundToWords({ start: 7, end: 10 }, w, 200), { start: 0, end: 8 });
  // Только пробелы — ближайшее слово.
  assertEquals(roundToWords({ start: 8, end: 9 }, wordSpans('abcdefgh  ijk'), 200), { start: 0, end: 8 });
});

Deno.test('округление: не длиннее лимита, слова отпадают с конца', () => {
  const text = words(60);
  const r = roundToWords({ start: 0, end: Array.from(text).length }, wordSpans(text), 200)!;

  assert(r.end - r.start <= 200);
  assertEquals(r.start, 0);
  assert(wordSpans(text).some((w) => w.end === r.end));
});

// =============================================================================
// 1. Карта популярности
// =============================================================================

const TRUMP = 'Вчера Трамп заявил, что пошлины вырастут вдвое';

Deno.test('К1.1 пять букв «Трамп» по одной с комментариями — тот же слой, что слово целиком', () => {
  const letters: Spec[] = Array.from({ length: 5 }, (_, i) => [`b${i}`, 6 + i, 7 + i, [['boris', 'c', i]]]);
  const whole: Spec[] = [['g', 6, 11, [['gleb', 'c', 1]]]];
  const boris = heightMapOf(input(TRUMP, letters)).map;
  const gleb = heightMapOf(input(TRUMP, whole)).map;
  const both = heightMapOf(input(TRUMP, [...letters, ...whole])).map;

  assertEquals(boris.height, gleb.height);
  assertEquals(boris.height[1], 1.5);
  assertEquals(both.height[1], 3);
  assertEquals(both.people[1], 2);
});

Deno.test('К1.2 тридцать одинаковых фрагментов внахлёст одного человека — слой как от одного', () => {
  const text = 'начало ' + words(10, 'w') + ' конец';
  const many: Spec[] = Array.from({ length: 30 }, (_, i) => [`f${i}`, 7 + (i % 3), 30 + (i % 4), [['u1', 'c', i]]]);
  const one: Spec[] = [['one', 7, 33, [['u1', 'c', 1]]]];
  const a = heightMapOf(input(text, many));
  const b = heightMapOf(input(text, one));

  assertEquals(a.map.height, b.map.height);
  assertEquals(a.map.continuity, b.map.continuity);
  assertEquals(a.context.people, 1);
  assertEquals(a.context.pieces, 1);
});

Deno.test('К1.3 удалённый аккаунт — каждый его голос отдельный человек', () => {
  const { map, context } = heightMapOf(
    input(TRUMP, [
      ['a', 6, 11, [[null, 'r', 1]]],
      ['b', 6, 11, [[null, 'r', 2]]],
    ]),
  );

  assertEquals(context.people, 2);
  assertEquals(map.height[1], 2);
  assertEquals(computeClusters(input(TRUMP, [['a', 6, 11, [[null, 'r', 1], [null, 'c', 2]]]])).clusters[0].people, 2);
});

Deno.test('карта: два человека по трём буквам с разных концов слова — у слова высота 2', () => {
  const text = 'abcde xyz';
  const { map } = heightMapOf(
    input(text, [
      ['l', 0, 3, [['u1', 'r', 1]]],
      ['r', 2, 5, [['u2', 'r', 2]]],
    ]),
  );

  assertEquals(map.height, [2, 0]);
});

Deno.test('карта: все выделили меньше половины слова — слово входит при любом пересечении', () => {
  const { map } = heightMapOf(input('abcdefgh ijk', [['a', 0, 2, [['u1', 'r', 1]]]]));

  assertEquals(map.height, [1, 0]);
});

// =============================================================================
// 2. Эталонные сценарии модели
// =============================================================================

Deno.test('К2.1 «Трамп» — подсвечивается вершина, а не всё предложение', () => {
  const [, phraseEnd] = wordsRange(TRUMP, 0, 2);
  const { clusters } = computeClusters(
    input(TRUMP, [
      ...crowd('t', 6, 6, 11),
      ...crowd('a', 2, 0, phraseEnd - 1),
      ...crowd('b', 2, 6, 46),
    ]),
  );

  assertEquals(clusters.length, 1);
  assertEquals(shownTexts(TRUMP, clusters), ['Трамп']);
  assertEquals(clusters[0].people, 10);
});

Deno.test('К2.2 десять человек выделили одну фразу из шести слов — она вся', () => {
  const text = 'Начало сообщения. Это та самая фраза из шести слов, а дальше обычный текст без выделений.';
  const [start, end] = wordsRange(text, 3, 8);
  const { clusters } = computeClusters(input(text, crowd('p', 10, start, end)));

  assertEquals(shownTexts(text, clusters), ['та самая фраза из шести слов,']);
});

Deno.test('К2.3 абзац 400 символов целиком и фраза в конце — подсвечена фраза, не начало', () => {
  const text = words(60);
  const length = Array.from(text).length;
  const [phraseStart, phraseEnd] = wordsRange(text, 53, 58);

  assert(length >= 400);

  const { clusters } = computeClusters(
    input(text, [
      ...crowd('u', 20, 0, length, 'r'),
      // 15 из тех же людей прокомментировали фразу в конце.
      ...Array.from({ length: 15 }, (_, i) => [`c${i}`, phraseStart, phraseEnd, [[`u${i}`, 'c', 100 + i]]] as Spec),
    ]),
  );
  const d = shown(clusters).map((c) => c.display!);

  assertEquals(d.length, 1);
  assertEquals(d[0], { start: phraseStart, end: phraseEnd });
  assertDisplayInvariants(text, clusters, true);
});

Deno.test('К2.4 ровное плато 600 символов — первые ≤200 по словам', () => {
  const text = words(110);
  const { clusters } = computeClusters(input(text, crowd('u', 5, 0, 600)));

  assertEquals(clusters.length, 1);

  const d = clusters[0].display!;

  assertEquals(d.start, 0);
  assert(d.end - d.start <= 200 && d.end - d.start > 180, `длина ${d.end - d.start}`);
  assertDisplayInvariants(text, clusters, true);
});

Deno.test('К2.5 две вершины: глубокая впадина — два кластера, мелкая — один', () => {
  const text = words(30, 'w');
  const [a0, a1] = wordsRange(text, 2, 5);
  const [b0, b1] = wordsRange(text, 10, 13);
  const peaks = [...crowd('a', 10, a0, a1), ...crowd('b', 10, b0, b1)];

  const deep = computeClusters(input(text, [...peaks, ...crowd('s', 1, a0, b1)]));
  const shallow = computeClusters(input(text, [...peaks, ...crowd('s', 15, a0, b1)]));

  assertEquals(deep.clusters.length, 2);
  assertEquals(shallow.clusters.length, 1);
});

Deno.test('К2.6 масштаб: провал в одного человека при 3 людях — шум, при 300 — разрез', () => {
  const text = words(10, 'w');
  const [all0, all1] = wordsRange(text, 1, 8);
  const [l0, l1] = wordsRange(text, 1, 3);
  const [r0, r1] = wordsRange(text, 6, 8);
  const shape = (k: number): Spec[] => [
    ...crowd('all', 2 * k, all0, all1),
    // Каждый из этих k — два отдельных куска.
    ...Array.from({ length: k }, (_, i) => [`l${i}`, l0, l1, [[`two${i}`, 'r', i]]] as Spec),
    ...Array.from({ length: k }, (_, i) => [`r${i}`, r0, r1, [[`two${i}`, 'r', i]]] as Spec),
  ];

  assertEquals(computeClusters(input(text, shape(1))).clusters.length, 1);
  assertEquals(computeClusters(input(text, shape(100))).clusters.length, 2);
});

Deno.test('К2.7 естественная длина: по слову — короткие кластеры, фразами — кластеры-фразы', () => {
  const text = 'Сегодня мы наконец запустили новую версию приложения для всех пользователей сразу';
  const w = wordSpans(text);
  // А: каждый выделяет одно слово в «запустили новую версию приложения».
  const a: Spec[] = [3, 4, 5, 6].flatMap((k, j) => crowd(`a${k}-`, [3, 4, 3, 2][j], w[k].start, w[k].end));
  // Б: те же люди выделяют фразы.
  const b: Spec[] = [
    ...crowd('b', 8, w[3].start, w[6].end),
    ...crowd('c', 2, w[2].start, w[5].end),
    ...crowd('d', 2, w[4].start, w[7].end),
  ];
  const countWords = (r: Range) => wordSpans(slice(text, r)).length;

  const byWords = shown(computeClusters(input(text, a)).clusters).map((c) => countWords(c.display!));
  const byPhrases = shown(computeClusters(input(text, b)).clusters).map((c) => countWords(c.display!));

  assert(byWords.length >= 1 && byWords.every((n) => n === 1), `А: ${byWords}`);
  assert(byPhrases.length === 1 && byPhrases[0] >= 3, `Б: ${byPhrases}`);
});

Deno.test('К2.7 естественная длина решает спорный случай', () => {
  // Слово «версию» (3 + 3 человека) внутри фразы (3 человека): толщина слоёв
  // одинакова. Решает, какой длины кусками выделяют в остальном сообщении.
  const head = 'Сегодня мы наконец запустили новую версию приложения для всех пользователей. ';
  const text = head + words(40, 'фон');
  const w = wordSpans(text);
  const target: Spec[] = [...crowd('x', 3, w[5].start, w[5].end), ...crowd('p', 3, w[3].start, w[6].end)];
  const singles: Spec[] = Array.from({ length: 8 }, (_, i) => crowd(`s${i}-`, 1, w[12 + 3 * i].start, w[12 + 3 * i].end)[0]);
  const phrases: Spec[] = Array.from({ length: 8 }, (_, i) => crowd(`f${i}-`, 1, w[12 + 3 * i].start, w[14 + 3 * i].end)[0]);
  const atTarget = (clusters: ModelCluster[]) =>
    slice(text, clusters.find((c) => c.display && c.display.start < w[7].end)!.display!);

  assertEquals(atTarget(computeClusters(input(text, [...target, ...singles])).clusters), 'версию');
  assertEquals(atTarget(computeClusters(input(text, [...target, ...phrases])).clusters), 'запустили новую версию приложения');
});

Deno.test('К2.8 вложенность [0,30) [5,10) [7,9) — подсвечен кусок внутри, не [0,30)', () => {
  const text = 'abcd efghi jk lmnop qrstu vwxyz хвост ещё';
  const { clusters } = computeClusters(
    input(text, [
      ['a', 0, 30, [['u1', 'r', 1]]],
      ['b', 5, 10, [['u2', 'r', 2]]],
      ['c', 7, 9, [['u3', 'r', 3]]],
    ]),
  );

  assertEquals(shownTexts(text, clusters), ['efghi']);
  assertEquals(clusters.flatMap((c) => c.fragmentIds).sort(), ['a', 'b', 'c']);
});

Deno.test('К2.9 соседние [0,5) и [5,10) от разных людей с общей границей — два кластера', () => {
  const text = 'abcd efghi klmno';
  const { clusters } = computeClusters(input(text, [...crowd('l', 3, 0, 5), ...crowd('r', 3, 5, 10)]));

  assertEquals(clusters.length, 2);
  assertEquals(clusters.map((c) => slice(text, c)), ['abcd', 'efghi']);
});

Deno.test('К2.9 стык внахлёст: одни кончают на слове, другие с него начинают — тоже два', () => {
  const text = words(12, 'w');
  const [a0, a1] = wordsRange(text, 0, 5);
  const [b0, b1] = wordsRange(text, 5, 10);
  const { clusters } = computeClusters(input(text, [...crowd('l', 5, a0, a1), ...crowd('r', 5, b0, b1)]));

  assertEquals(clusters.length, 2);
});

Deno.test('К2.10 один фрагмент на сообщении — он отображается', () => {
  const text = 'Один фрагмент на всё сообщение';
  const { clusters } = computeClusters(input(text, [['a', 5, 13, [['u1', 'r', 1]]]]));

  assertEquals(clusters.length, 1);
  assertEquals(slice(text, clusters[0].display!), 'фрагмент');
});

Deno.test('К2.11 в редком месте показывается менее популярный кластер, чем в густом', () => {
  const text = words(130);
  // Густое место: три популярных рядом; редкое — один послабее далеко.
  const dense: Spec[] = [0, 20, 40].flatMap((start, k) => crowd(`d${k}-`, 6 - k, start, start + 7));
  const sparse = crowd('s', 3, 700, 707);
  const { clusters } = computeClusters(input(text, [...dense, ...sparse], { params: { maxDisplayed: 2 } }));
  const visible = shown(clusters);

  assertEquals(visible.length, 2);
  assert(visible.some((c) => c.fragmentIds.includes(sparse[0][0])), 'редкое место не показано');
});

Deno.test('К2.12 устойчивость: голос в неотображаемом месте не перетряхивает набор', () => {
  const rnd = rng(12);
  const text = randomText(rnd, 2500);
  const { input: data } = randomInput(rnd, text, 500, 120);
  const first = computeClusters(data).clusters;
  const displays = shown(first).map((c) => c.display!);
  const spans = wordSpans(text);
  const free = spans.find((s) => !displays.some((d) => d.start < s.end && s.start < d.end) && s.start > 1000)!;
  const next: ClusterModelInput = {
    ...data,
    previous: previousOf(first),
    fragments: [...data.fragments, { id: 'new', start: free.start, end: free.end }],
    votes: [...data.votes, { fragmentId: 'new', userId: 'newcomer', kind: 'reaction', at: 9e6 }],
  };
  const again = computeClusters({ ...data, previous: previousOf(first) }).clusters;
  const after = computeClusters(next).clusters;
  const ranges = (cs: ModelCluster[]) =>
    shown(cs)
      .map((c) => `${c.display!.start}-${c.display!.end}`)
      .sort();

  assertEquals(ranges(again), ranges(first));
  assertEquals(ranges(after), ranges(first));
});

Deno.test('К2.12 устойчивость на 50 случайных сообщениях', () => {
  const rnd = rng(1212);
  let unchanged = 0;

  for (let n = 0; n < 50; n += 1) {
    const text = randomText(rnd, 800 + Math.floor(rnd() * 2000));
    const { input: data } = randomInput(rnd, text, 300 + Math.floor(rnd() * 400), 40 + Math.floor(rnd() * 100));
    const first = computeClusters(data).clusters;
    const displays = shown(first).map((c) => c.display!);
    const free = wordSpans(text).filter((s) => !displays.some((d) => d.start < s.end && s.start < d.end));
    const pick = free[Math.floor(rnd() * free.length)];

    if (!pick) continue;

    const after = computeClusters({
      ...data,
      previous: previousOf(first),
      fragments: [...data.fragments, { id: 'new', start: pick.start, end: pick.end }],
      votes: [...data.votes, { fragmentId: 'new', userId: 'newcomer', kind: 'reaction', at: 9e6 }],
    }).clusters;
    const key = (cs: ModelCluster[]) =>
      shown(cs)
        .map((c) => `${c.display!.start}-${c.display!.end}`)
        .sort()
        .join(',');

    if (key(after) === key(first)) unchanged += 1;
  }

  assert(unchanged >= 48, `набор не изменился в ${unchanged} из 50`);
});

// =============================================================================
// QA-матрица
// =============================================================================

Deno.test('дубликаты: три человека на одном куске — один кластер', () => {
  const text = 'какой-то другой уровень понимания';
  const { clusters } = computeClusters(
    input(text, [
      ['a', 9, 15, [['u1', 'r', 1]]],
      ['b', 9, 15, [['u2', 'r', 2]]],
      ['c', 9, 15, [['u3', 'c', 3]]],
    ]),
  );

  assertEquals(clusters.length, 1);
  assertEquals(clusters[0].people, 3);
  assertEquals(slice(text, clusters[0].display!), 'другой');
});

Deno.test('далёкие куски — разные кластеры', () => {
  const text = words(30);
  const { clusters } = computeClusters(
    input(text, [
      ['a', 0, 6, [['u1', 'r', 1]]],
      ['b', 100, 106, [['u1', 'r', 2]]],
    ]),
  );

  assertEquals(clusters.length, 2);
});

Deno.test('покрытие 85%: длинный кусок плюс короткие внутри — отображается не больше 200 по словам', () => {
  const text = words(40);
  const length = Array.from(text).length;
  const cover = Math.floor(length * 0.85);
  const { clusters } = computeClusters(
    input(text, [
      ['big', 0, cover, [['u1', 'c', 1]]],
      ['x', 10, 20, [['u2', 'r', 2]]],
      ['y', 40, 50, [['u3', 'r', 3]]],
    ]),
  );

  assertDisplayInvariants(text, clusters, true);
  assertEquals(shown(clusters).length >= 1, true);
});

Deno.test('20 разных диапазонов на 25 символах — инварианты держатся, все фрагменты разложены', () => {
  const text = 'abcde fghij klmno pqrst uvw';
  const specs: Spec[] = Array.from({ length: 20 }, (_, i) => [
    `f${i}`,
    i,
    Math.min(25, i + 3 + (i % 4)),
    [[`u${i}`, 'r', i]],
  ]);
  const { clusters } = computeClusters(input(text, specs));

  assertEquals(clusters.flatMap((c) => c.fragmentIds).length, 20);
  assertDisplayInvariants(text, clusters, true);
});

Deno.test('20 разбросанных на 1000 символах — 20 кластеров, отображаемых по длине текста', () => {
  const text = Array.from({ length: 100 }, (_, i) => `word${String(i).padStart(5, '0')}`).join(' ');

  assertEquals(Array.from(text).length, 999);

  const specs: Spec[] = Array.from({ length: 20 }, (_, i) => [
    `f${i}`,
    i * 50,
    i * 50 + 8,
    Array.from({ length: (i % 5) + 1 }, (_, k) => [`u${i}-${k}`, 'r', k] as [string, 'r', number]),
  ]);
  const { clusters } = computeClusters(input(text, specs));

  assertEquals(clusters.length, 20);
  assertDisplayInvariants(text, clusters, true);
  // 1000 символов — до 8 мест.
  const visible = shown(clusters);

  assert(visible.length >= 3 && visible.length <= 8, `отображается ${visible.length}`);
});

Deno.test('Unicode: смещения в code points, эмодзи и кириллица', () => {
  const text = '🔥🔥 Огонь 👍🏽 класс';
  // «Огонь» — code points [3, 8).
  const { clusters } = computeClusters(input(text, [['a', 3, 8, [['u1', 'r', 1]]]]));

  assertEquals(slice(text, clusters[0].display!), 'Огонь');
});

Deno.test('фрагменты только в пробелах — кластер у ближайшего слова', () => {
  const text = 'abc     def';
  const { clusters } = computeClusters(input(text, [['a', 4, 6, [['u1', 'r', 1]]]]));

  assertEquals(clusters.length, 1);
  assertEquals(clusters[0].fragmentIds, ['a']);
  assertDisplayInvariants(text, clusters, true);
});

Deno.test('500 диапазонов — инварианты держатся', () => {
  const rnd = rng(500);
  const text = randomText(rnd, 2000);
  const { input: data } = randomInput(rnd, text, 500, 40);

  assertDisplayInvariants(text, computeClusters(data).clusters, true);
});

Deno.test('журнал решения: контекст, кандидаты с признаками, выбранное — без текста', () => {
  const { clusters, decision } = computeClusters(
    input(TRUMP, [...crowd('t', 6, 6, 11), ...crowd('b', 2, 6, 46)]),
  );

  assert(decision);
  assertEquals(decision.selected, shown(clusters).map((c) => c.display));
  assertEquals(decision.context.people, 8);
  assert(decision.basins[0].candidates.length >= 2);
  assert('thickness' in decision.basins[0].candidates[0]);
  assert(!JSON.stringify(decision).includes('Трамп'));
});

// =============================================================================
// Решения человека
// =============================================================================

Deno.test('30 соседних букв одного человека с комментариями — один кластер, один голос', () => {
  const text = 'начало ' + 'а'.repeat(30) + ' конец';
  const specs: Spec[] = Array.from({ length: 30 }, (_, i) => [`f${i}`, 7 + i, 8 + i, [['u1', 'c', i]]]);
  const { clusters } = computeClusters(input(text, specs));

  assertEquals(clusters.length, 1);
  assertEquals(clusters[0].people, 1);
  assertEquals(clusters[0].fragmentIds.length, 30);
  assertEquals(slice(text, clusters[0].display!), 'а'.repeat(30));
});

Deno.test('30 комментариев одного человека слабее 5 разных людей', () => {
  const text = words(40);
  const spam: Spec = ['spam', 0, 6, Array.from({ length: 30 }, (_, i) => ['u1', 'c', i] as ['u1', 'c', number])];
  const crowdSpecs: Spec[] = Array.from({ length: 5 }, (_, i) => [`p${i}`, 150, 156, [[`p${i}`, 'c', i]]]);
  const { clusters } = computeClusters(input(text, [spam, ...crowdSpecs]));
  const spamCluster = clusters.find((c) => c.fragmentIds.includes('spam'))!;
  const crowdCluster = clusters.find((c) => c.fragmentIds.includes('p0'))!;

  assert(crowdCluster.popularity > spamCluster.popularity);
});

Deno.test('слияние: общее выделение сливает два кластера в один, id у старшего', () => {
  const text = words(20, 'w');
  const [a0, a1] = wordsRange(text, 0, 3);
  const [b0, b1] = wordsRange(text, 8, 11);
  const left = crowd('a', 3, a0, a1);
  const right = crowd('b', 3, b0, b1);
  const data = input(text, [...left, ...right, ...crowd('all', 10, a0, b1)], {
    previous: [
      { id: 'K2', start: b0, end: b1, createdAt: 2 },
      { id: 'K1', start: a0, end: a1, createdAt: 1 },
    ],
  });

  data.fragments.forEach((f) => {
    if (f.id.startsWith('a')) f.clusterId = f.id.startsWith('all') ? null : 'K1';
    if (f.id.startsWith('b')) f.clusterId = 'K2';
  });

  const { clusters } = computeClusters(data);

  assertEquals(clusters.length, 1);
  assertEquals(clusters[0].fragmentIds.length, 16);
  assertEquals(clusters[0].id, 'K1');
});

Deno.test('накрутка: один человек мостом из 40 кусков не сливает два места', () => {
  const text = words(60);
  const left = crowd('l', 4, 0, 12);
  const right = crowd('r', 4, 150, 162);
  const bridge: Spec[] = Array.from({ length: 40 }, (_, i) => [`s${i}`, 10 + i * 4, 16 + i * 4, [['spammer', 'c', i]]]);
  const { clusters } = computeClusters(input(text, [...left, ...right, ...bridge]));
  const leftCluster = clusters.find((c) => c.fragmentIds.includes(left[0][0]))!;
  const rightCluster = clusters.find((c) => c.fragmentIds.includes(right[0][0]))!;

  assert(leftCluster !== rightCluster, 'мост одного человека склеил кластеры');
  // Все фрагменты моста к кому-то прикреплены.
  assertEquals(clusters.flatMap((c) => c.fragmentIds).length, 48);
});

Deno.test('цепочка разных фраз внахлёст не сливается в один кластер', () => {
  const text = words(120);
  // 12 людей, каждый — своя фраза в 60 символов, соседи заходят друг на друга на 5.
  const specs: Spec[] = Array.from({ length: 12 }, (_, i) => [`f${i}`, i * 55, i * 55 + 60, [[`u${i}`, 'r', i]]]);
  const { clusters } = computeClusters(input(text, specs));

  assert(clusters.length >= 4, `кластеров ${clusters.length}`);
  assertDisplayInvariants(text, clusters, true);
});

Deno.test('разрезанный кластер: id остаётся у части с большим пересечением', () => {
  const text = words(60);
  const specs: Spec[] = [
    ['a', 0, 50, [['u1', 'r', 1]]],
    ['b', 300, 330, [['u2', 'r', 2]]],
  ];
  const { clusters } = computeClusters(
    input(text, specs, { previous: [{ id: 'K', start: 0, end: 330, createdAt: 1 }] }),
  );

  assertEquals(
    clusters.map((c) => c.id),
    ['K', null],
  );
});

// =============================================================================
// К2.13 Свойства на случайных данных, К2.14 бюджет
// =============================================================================

Deno.test('К2.13 свойства: 1000 случайных входов — инварианты, разложение, порядок входа', () => {
  const rnd = rng(42);

  for (let n = 0; n < 1000; n += 1) {
    const text = randomText(rnd, 1 + Math.floor(rnd() * 1200));
    const length = Array.from(text).length;
    const count = Math.floor(rnd() * 60);
    const { input: data } = randomInput(rnd, text, count, 1 + Math.floor(rnd() * 15), length);
    const result = computeClusters(data);
    const valid = data.fragments.filter((f) => f.end > f.start).map((f) => f.id);

    assertDisplayInvariants(text, result.clusters, valid.length > 0);
    assertEquals(result.clusters.flatMap((c) => c.fragmentIds).sort(), valid.sort());

    if (n % 10 === 0) {
      const shuffled: ClusterModelInput = {
        ...data,
        fragments: shuffle([...data.fragments], rng(n + 1)),
        votes: shuffle([...data.votes], rng(n + 2)),
      };

      assertEquals(computeClusters(shuffled), result);
    }
  }
});

Deno.test('К2.13 порядок входа на большом сообщении', () => {
  const rnd = rng(7);
  const text = randomText(rnd, 1500);
  const { input: data } = randomInput(rnd, text, 300, 30);
  const shuffled: ClusterModelInput = {
    ...data,
    fragments: shuffle([...data.fragments], rng(1)),
    votes: shuffle([...data.votes], rng(2)),
  };

  assertEquals(computeClusters(shuffled), computeClusters(data));
});

Deno.test('К2.14 бюджет: 1 000 / 10 000 / 100 000 фрагментов на 4 000 символах', () => {
  const rnd = rng(3);
  const text = randomText(rnd, 4000);
  const total: Record<number, number> = {};
  const relief: Record<number, number> = {};
  const best = (f: () => void) => {
    let min = Infinity;

    for (let i = 0; i < 3; i += 1) {
      const started = performance.now();

      f();
      min = Math.min(min, performance.now() - started);
    }

    return min;
  };

  for (const count of [1_000, 10_000, 100_000]) {
    const { input: data } = randomInput(rnd, text, count, Math.ceil(count / 5));
    const { map, context } = heightMapOf(data);

    total[count] = best(() => computeClusters(data));
    relief[count] = best(() => computeRelief(map, context));
    assertDisplayInvariants(text, computeClusters(data).clusters, true);
  }

  const line = (t: Record<number, number>) =>
    Object.entries(t)
      .map(([n, ms]) => `${n} — ${ms.toFixed(1)} мс`)
      .join(', ');

  console.log(`модель целиком: ${line(total)}\nпосле карты: ${line(relief)}`);

  // Прежняя модель на тех же данных: 5.9 / 34.7 / 773 мс.
  assert(total[10_000] < 150, `10 000 фрагментов — ${total[10_000].toFixed(1)} мс`);
  assert(total[100_000] < 773, `100 000 фрагментов — ${total[100_000].toFixed(1)} мс`);
  // После карты время ограничено длиной текста (числом слов и бассейнов), а не
  // числом фрагментов: на 4 000 символах — единицы миллисекунд при любом входе.
  for (const ms of Object.values(relief)) assert(ms < 25, `после карты — ${ms.toFixed(1)} мс`);
});

// =============================================================================
// Генераторы
// =============================================================================

function rng(seed: number) {
  let s = seed >>> 0 || 1;

  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;

    return s / 4294967296;
  };
}

function shuffle<T>(items: T[], rnd: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));

    [items[i], items[j]] = [items[j], items[i]];
  }

  return items;
}

const ALPHABET = Array.from('абвгдеёжзиклмнопрстуфхцчшщэюяabcdefghijklmnopqrstuvwxyz0123456789,.!?—…🔥👍🏽😂');

function randomText(rnd: () => number, length: number): string {
  const out: string[] = [];

  while (out.length < length) {
    // Иногда — слово длиннее 200, иногда — пробелы и переносы подряд.
    const long = rnd() < 0.003;
    const size = long ? 201 + Math.floor(rnd() * 50) : 1 + Math.floor(rnd() * 12);

    for (let i = 0; i < size && out.length < length; i += 1) out.push(ALPHABET[Math.floor(rnd() * ALPHABET.length)]);

    if (out.length < length) out.push(rnd() < 0.1 ? '\n' : ' ');
    if (rnd() < 0.05 && out.length < length) out.push(' ');
  }

  return out.join('');
}

function randomInput(rnd: () => number, text: string, count: number, people: number, length = Array.from(text).length) {
  const specs: Spec[] = [];

  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(rnd() * length);
    const size = 1 + Math.floor(rnd() < 0.1 ? rnd() * 400 : rnd() * 30);
    const end = Math.min(length, start + size);

    if (end <= start) continue;

    const votes: Spec[3] = [];
    const n = 1 + Math.floor(rnd() * 3);

    for (let k = 0; k < n; k += 1) {
      votes.push([rnd() < 0.02 ? null : `u${Math.floor(rnd() * people)}`, rnd() < 0.5 ? 'r' : 'c', Math.floor(rnd() * 1e6)]);
    }

    specs.push([`f${i}`, start, end, votes]);
  }

  return { input: input(text, specs) };
}
