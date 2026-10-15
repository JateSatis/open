// Эталонные сценарии модели кластеров. Запуск: npm run test:functions.

import { assert, assertEquals } from 'jsr:@std/assert@1';

import {
  computeClusters,
  roundToWords,
  wordSpans,
  type ClusterModelInput,
  type FragmentInput,
  type ModelCluster,
  type Range,
  type VoteInput,
} from './fragmentClusters.ts';

type Spec = [id: string, start: number, end: number, votes: [user: string | null, kind: 'r' | 'c', at: number][]];

function input(text: string, specs: Spec[], extra: Partial<ClusterModelInput> = {}): ClusterModelInput {
  const fragments: FragmentInput[] = specs.map(([id, start, end]) => ({ id, start, end }));
  const votes: VoteInput[] = specs.flatMap(([id, , , vs]) =>
    vs.map(([userId, kind, at]) => ({ fragmentId: id, userId, kind: kind === 'r' ? 'reaction' : 'comment', at })),
  );

  return { text, fragments, votes, ...extra };
}

const shown = (clusters: ModelCluster[]) => clusters.filter((c) => c.display);

const slice = (text: string, r: Range) => Array.from(text).slice(r.start, r.end).join('');

const words = (n: number, word = 'слово') => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');

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

Deno.test('вложенность [0,30) [5,10) [7,9) — один кластер [0,30)', () => {
  const text = 'a'.repeat(5) + ' ' + 'b'.repeat(10) + ' ' + 'c'.repeat(13) + ' хвост';
  const { clusters } = computeClusters(
    input(text, [
      ['a', 0, 30, [['u1', 'r', 1]]],
      ['b', 5, 10, [['u2', 'r', 2]]],
      ['c', 7, 9, [['u3', 'r', 3]]],
    ]),
  );

  assertEquals(clusters.map((c) => [c.start, c.end]), [[0, 30]]);
  assertEquals(clusters[0].fragmentIds, ['a', 'b', 'c']);
});

Deno.test('цепочка [0,10) [8,20) [18,30) — один кластер', () => {
  const text = words(20, 'w');
  const { clusters } = computeClusters(
    input(text, [
      ['a', 0, 10, [['u1', 'r', 1]]],
      ['b', 8, 20, [['u2', 'r', 2]]],
      ['c', 18, 30, [['u3', 'r', 3]]],
    ]),
  );

  assertEquals(clusters.map((c) => [c.start, c.end]), [[0, 30]]);
});

Deno.test('смежность [0,5) [5,10) — склеиваются', () => {
  const { clusters } = computeClusters(
    input('abcdefghij klm', [
      ['a', 0, 5, [['u1', 'r', 1]]],
      ['b', 5, 10, [['u2', 'r', 2]]],
    ]),
  );

  assertEquals(clusters.map((c) => [c.start, c.end]), [[0, 10]]);
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

Deno.test('20 диапазонов на 25 символах — один кластер, одно отображаемое', () => {
  const text = 'abcde fghij klmno pqrst uvw';
  const specs: Spec[] = Array.from({ length: 20 }, (_, i) => [
    `f${i}`,
    i,
    Math.min(25, i + 3 + (i % 4)),
    [[`u${i}`, 'r', i]],
  ]);
  const { clusters } = computeClusters(input(text, specs));

  assertEquals(clusters.length, 1);
  assertEquals(shown(clusters).length, 1);
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
  // 1000 символов — до 8 мест, но не больше половины текста.
  const visible = shown(clusters);

  assert(visible.length >= 3 && visible.length <= 8, `отображается ${visible.length}`);
});

Deno.test('Unicode: смещения в code points, эмодзи и кириллица', () => {
  const text = '🔥🔥 Огонь 👍🏽 класс';
  // «Огонь» — code points [3, 8).
  const { clusters } = computeClusters(input(text, [['a', 3, 8, [['u1', 'r', 1]]]]));

  assertEquals(slice(text, clusters[0].display!), 'Огонь');
});

Deno.test('500 диапазонов — инварианты держатся', () => {
  const rnd = rng(500);
  const text = randomText(rnd, 2000);
  const { input: data } = randomInput(rnd, text, 500, 40);

  assertDisplayInvariants(text, computeClusters(data).clusters, true);
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
  const crowd: Spec[] = Array.from({ length: 5 }, (_, i) => [`p${i}`, 150, 156, [[`p${i}`, 'c', i]]]);
  const { clusters } = computeClusters(input(text, [spam, ...crowd]));
  const spamCluster = clusters.find((c) => c.fragmentIds.includes('spam'))!;
  const crowdCluster = clusters.find((c) => c.fragmentIds.includes('p0'))!;

  assert(crowdCluster.popularity > spamCluster.popularity);
});

Deno.test('мост сливает два кластера — один, id старшего', () => {
  const text = words(20, 'w');
  const specs: Spec[] = [
    ['a', 0, 10, [['u1', 'r', 1]]],
    ['b', 20, 30, [['u1', 'r', 2]]],
    ['bridge', 8, 22, [['u2', 'r', 3]]],
  ];
  const data = input(text, specs, {
    previous: [
      { id: 'K2', start: 20, end: 30, createdAt: 2 },
      { id: 'K1', start: 0, end: 10, createdAt: 1 },
    ],
  });

  data.fragments[0].clusterId = 'K1';
  data.fragments[1].clusterId = 'K2';

  const { clusters } = computeClusters(data);

  // От u1 в ядре осталась одна (последняя) реакция — в K2, но фрагмент из K1
  // прикреплён к тому же кластеру: общих фрагментов поровну, id у старшего.
  assertEquals(clusters.length, 1);
  assertEquals(clusters[0].fragmentIds, ['a', 'bridge', 'b']);
  assertEquals(clusters[0].id, 'K1');
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

Deno.test('один фрагмент на сообщении — он отображается', () => {
  const text = 'Один фрагмент на всё сообщение';
  const { clusters } = computeClusters(input(text, [['a', 5, 13, [['u1', 'r', 1]]]]));

  assertEquals(clusters.length, 1);
  assertEquals(slice(text, clusters[0].display!), 'фрагмент');
});

Deno.test('кластер 600 символов, выделенный целиком, — отображаются первые ≤200 по словам', () => {
  const text = words(110);
  const specs: Spec[] = Array.from({ length: 5 }, (_, i) => [`f${i}`, 0, 600, [[`u${i}`, 'r', i]]]);
  const { clusters } = computeClusters(input(text, specs));

  assertEquals(clusters.length, 1);
  assertEquals(clusters[0].end - clusters[0].start, 600);

  const d = clusters[0].display!;

  assertEquals(d.start, 0);
  assert(d.end - d.start <= 200 && d.end - d.start > 180);
  assertDisplayInvariants(text, clusters, true);
});

Deno.test('цепочка разных фраз длиннее 200 режется по слабым местам', () => {
  const text = words(120);
  // 12 людей, каждый — своя фраза в 60 символов, соседи заходят друг на друга на 5.
  const specs: Spec[] = Array.from({ length: 12 }, (_, i) => [
    `f${i}`,
    i * 55,
    i * 55 + 60,
    [[`u${i}`, 'r', i]],
  ]);
  const { clusters } = computeClusters(input(text, specs));

  assert(clusters.length >= 4, `кластеров ${clusters.length}`);
  for (const c of clusters) assert(c.end - c.start <= 200);
});

Deno.test('накрутка: один человек мостом из 40 кусков не сливает два места', () => {
  const text = words(60);
  const left: Spec[] = Array.from({ length: 4 }, (_, i) => [`l${i}`, 0, 12, [[`a${i}`, 'r', i]]]);
  const right: Spec[] = Array.from({ length: 4 }, (_, i) => [`r${i}`, 150, 162, [[`b${i}`, 'r', i]]]);
  const bridge: Spec[] = Array.from({ length: 40 }, (_, i) => [
    `s${i}`,
    10 + i * 4,
    16 + i * 4,
    [['spammer', 'c', i]],
  ]);
  const { clusters } = computeClusters(input(text, [...left, ...right, ...bridge]));
  const leftCluster = clusters.find((c) => c.fragmentIds.includes('l0'))!;
  const rightCluster = clusters.find((c) => c.fragmentIds.includes('r0'))!;

  assert(leftCluster !== rightCluster, 'мост одного человека склеил кластеры');
  // Все фрагменты моста к кому-то прикреплены.
  assertEquals(clusters.flatMap((c) => c.fragmentIds).length, 48);
});

Deno.test('в редком месте показывается менее популярный кластер, чем в густом', () => {
  const text = words(130);
  // Густое место: три популярных рядом; редкое — один послабее далеко.
  const dense: Spec[] = [0, 20, 40].flatMap((start, k) =>
    Array.from({ length: 6 - k }, (_, i) => [`d${k}-${i}`, start, start + 7, [[`d${k}-${i}`, 'r', i]]] as Spec),
  );
  const sparse: Spec[] = Array.from({ length: 3 }, (_, i) => [`s${i}`, 700, 707, [[`s${i}`, 'r', i]]]);
  const { clusters } = computeClusters(input(text, [...dense, ...sparse], { params: { maxDisplayed: 2 } }));
  const visible = shown(clusters);

  assertEquals(visible.length, 2);
  assert(visible.some((c) => c.fragmentIds.includes('s0')), 'редкое место не показано');
});

Deno.test('детерминизм: порядок входа не меняет результат', () => {
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

Deno.test('все фрагменты разложены по кластерам ровно один раз', () => {
  const rnd = rng(11);
  const text = randomText(rnd, 3000);
  const { input: data } = randomInput(rnd, text, 800, 60);
  const ids = computeClusters(data).clusters.flatMap((c) => c.fragmentIds).sort();

  assertEquals(ids, data.fragments.map((f) => f.id).sort());
});

// =============================================================================
// Свойства на случайных данных и бюджет
// =============================================================================

Deno.test('свойства: 1000 случайных входов — отображаемые не пересекаются, ≤200, по словам, ≥1', () => {
  const rnd = rng(42);

  for (let n = 0; n < 1000; n += 1) {
    const text = randomText(rnd, 1 + Math.floor(rnd() * 1200));
    const length = Array.from(text).length;
    const count = Math.floor(rnd() * 60);
    const { input: data } = randomInput(rnd, text, count, 1 + Math.floor(rnd() * 15), length);
    const { clusters } = computeClusters(data);

    assertDisplayInvariants(text, clusters, data.fragments.length > 0);
  }
});

Deno.test('бюджет: 1 000 / 10 000 / 100 000 фрагментов на 4 000 символах', () => {
  const rnd = rng(3);
  const text = randomText(rnd, 4000);
  const timings: Record<number, number> = {};

  for (const count of [1_000, 10_000, 100_000]) {
    const { input: data } = randomInput(rnd, text, count, Math.ceil(count / 5));

    computeClusters(data);

    const started = performance.now();
    const { clusters } = computeClusters(data);

    timings[count] = performance.now() - started;
    assertDisplayInvariants(text, clusters, true);
  }

  console.log(
    `модель: ${Object.entries(timings)
      .map(([n, ms]) => `${n} — ${ms.toFixed(1)} мс`)
      .join(', ')}`,
  );

  assert(timings[10_000] < 150, `10 000 фрагментов — ${timings[10_000].toFixed(1)} мс`);
  // Рост ×10 по входу — не квадратичный (×100), с запасом на шум.
  assert(timings[100_000] < timings[10_000] * 30, 'время растёт квадратично');
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
