/**
 * Раскладка альбома в один ровный прямоугольник — как в Telegram.
 *
 * Плитки стараются сохранить пропорции своих файлов, но ради цельного
 * прямоугольника их можно подрезать (`contentFit="cover"`): широкое фото
 * становится уже, высокое — ниже. Искажения нет, есть только обрезка, и она
 * ограничена `MAX_CROP`.
 *
 * Подход взят у Telegram (`MessageObject.GroupedMessages` в Android-клиенте),
 * но не повторяет его буквально:
 *
 * - 2–4 файла раскладываются по явным правилам Telegram (широкие пары друг
 *   под другом, узкий первый — большой слева и так далее);
 * - 5–10 файлов (и 2–4, если правило дало негодную раскладку) — перебор
 *   разбиений последовательности на ряды и выбор самого дешёвого по
 *   `layoutCost`. Порядок файлов не меняется никогда.
 *
 * Всё считается в физических пикселях и только в конце переводится в dp:
 * края плиток лежат на целых пикселях, последняя плитка ряда или колонки
 * добирает остаток — иначе на стыках видны швы в полпикселя (тот же приём,
 * что в `gridLayout.ts` шита).
 */

import { Spacing } from '@/theme';

export type MosaicItem = {
  /** Размеры файла; `null` у старых сообщений — тогда плитка считается квадратом. */
  width: number | null;
  height: number | null;
};

export type MosaicTile = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MosaicLayout = {
  width: number;
  height: number;
  /** В порядке входных файлов. */
  tiles: MosaicTile[];
};

export type MosaicBounds = {
  /** Ширина альбома из 2+ файлов и верхняя граница ширины одиночного. */
  maxWidth: number;
  /** Одиночное медиа уже не бывает — узкий портрет подрезается. */
  minSingleWidth: number;
  /** Одиночное медиа выше не бывает — высокий кадр подрезается. */
  maxSingleHeight: number;
};

/** Разделитель между плитками. */
export const MOSAIC_GAP = Spacing.half;
/**
 * Короткая сторона плитки не бывает меньше. Раскладка, где это нарушено,
 * отбрасывается. Заметно больше минимума касания (48 dp), и на плитке
 * читается превью.
 */
export const MIN_TILE = 72;
/** Больше файлов в одном сообщении не бывает — остальные уходят следующими. */
export const MAX_ALBUM_SIZE = 10;

/** Доля ширины списка под медиа — как у облачка с текстом, чтобы альбом не выпирал. */
const MAX_WIDTH_RATIO = 0.75;
/** На планшете и в альбомной ориентации альбом не растёт дальше. */
const MAX_WIDTH_DP = 340;
const MIN_SINGLE_WIDTH_RATIO = 0.45;
const MIN_SINGLE_WIDTH_DP = 150;
/** Коробка одиночного медиа: высота к ширине. */
const SINGLE_HEIGHT_RATIO = 1.3;

/**
 * Пропорции плитки в альбоме: панорама и длинный скриншот дальше этого
 * подрезаются. В альбомах от 5 файлов портреты подрезаются сильнее, ближе к
 * квадрату: иначе десяток вертикальных кадров вырастает выше экрана.
 */
const MIN_ASPECT = 0.5;
const MIN_ASPECT_LARGE_ALBUM = 0.75;
const MAX_ASPECT = 2;
/** Обрезка сильнее — уже не «подрезали», а «показали другой кадр». */
const MAX_CROP = Math.log(2);

/** Альбом до 4 файлов не бывает выше этого (к ширине). */
const MAX_HEIGHT_RATIO = 1.3;
/** Желанная высота большого альбома к ширине. */
const TARGET_HEIGHT_RATIO = 1.05;
/** Первый файл сверху на всю ширину не занимает больше этой доли от предельной высоты. */
const TOP_ROW_SHARE = 0.5;
/** Больше плиток в ряду не бывает. */
const MAX_ROW_SIZE = 4;
const MAX_ROWS = 4;
/** Степени, в которые пробуется ужать ряды большого альбома ради высоты. */
const SHRINK_FACTORS = [0.85, 0.7];

/**
 * Границы размеров по ширине списка сообщений (в dp). Ширина мозаики
 * известна в первом же рендере, до `onLayout` облачка: иначе в перевёрнутом
 * списке строка прыгала бы по высоте.
 */
export function mosaicBounds(listWidth: number): MosaicBounds {
  const maxWidth = Math.min(Math.round(listWidth * MAX_WIDTH_RATIO), MAX_WIDTH_DP);

  return {
    maxWidth,
    minSingleWidth: Math.min(
      maxWidth,
      Math.max(Math.round(listWidth * MIN_SINGLE_WIDTH_RATIO), MIN_SINGLE_WIDTH_DP),
    ),
    maxSingleHeight: Math.round(maxWidth * SINGLE_HEIGHT_RATIO),
  };
}

// -----------------------------------------------------------------------------
// Планы раскладки в дробных пикселях
// -----------------------------------------------------------------------------

type Metrics = {
  /** Ширина альбома, px. */
  width: number;
  gap: number;
  min: number;
  maxHeight: number;
};

type RowsPlan = {
  kind: 'rows';
  rows: { widths: number[]; height: number }[];
};

/** Первый файл большой слева, остальные столбиком справа. */
type ColumnPlan = {
  kind: 'column';
  leftWidth: number;
  height: number;
  rightHeights: number[];
};

type Plan = RowsPlan | ColumnPlan;

type Scored = { plan: Plan; crops: number[]; height: number };

function aspectOf(item: MosaicItem, minAspect: number): number {
  const { width, height } = item;

  if (!width || !height || width <= 0 || height <= 0) return 1;

  return Math.min(MAX_ASPECT, Math.max(minAspect, width / height));
}

/** Насколько плитка отличается по пропорциям от своего файла: 0 — не подрезана. */
function cropOf(tileWidth: number, tileHeight: number, aspect: number): number {
  return Math.abs(Math.log(tileWidth / tileHeight / aspect));
}

/**
 * Ширины плиток ряда — пропорционально их пропорциям, но не уже `min`:
 * недостающее забирается у широких (они подрезаются), а не выдумывается.
 */
function rowWidths(aspects: number[], available: number, min: number): number[] | null {
  if (available < aspects.length * min) return null;

  const widths = new Array<number>(aspects.length).fill(0);
  const pinned = new Set<number>();

  // Каждый проход закрепляет хотя бы одну плитку, так что проходов не больше, чем плиток.
  for (let pass = 0; pass < aspects.length; pass++) {
    const free = aspects.map((_, i) => i).filter((i) => !pinned.has(i));
    const freeWidth = available - pinned.size * min;
    const freeAspect = free.reduce((sum, i) => sum + aspects[i], 0);
    let changed = false;

    for (const i of free) {
      widths[i] = (freeWidth * aspects[i]) / freeAspect;

      if (widths[i] < min) {
        widths[i] = min;
        pinned.add(i);
        changed = true;
      }
    }

    if (!changed) break;
  }

  return widths;
}

/** Ряд, растянутый на всю ширину: общая высота такая, чтобы ширины сошлись. */
function buildRow(aspects: number[], m: Metrics, maxRowHeight: number) {
  const available = m.width - m.gap * (aspects.length - 1);
  const widths = rowWidths(aspects, available, m.min);

  if (!widths) return null;

  const natural = available / aspects.reduce((sum, a) => sum + a, 0);
  const height = Math.max(m.min, Math.min(natural, maxRowHeight));

  return { widths, height };
}

/**
 * Ряды подряд. Каждый следующий ряд укладывается в то, что осталось от
 * предельной высоты альбома, — с запасом под минимальную высоту остальных.
 */
function rowsPlan(aspects: number[], sizes: number[], m: Metrics, firstRowMax?: number) {
  const rows: RowsPlan['rows'] = [];
  let start = 0;
  let used = 0;

  for (const [index, size] of sizes.entries()) {
    const reserve = (sizes.length - index - 1) * (m.min + m.gap);
    const budget = m.maxHeight - used - (index > 0 ? m.gap : 0) - reserve;
    const cap = Math.min(budget, index === 0 && firstRowMax !== undefined ? firstRowMax : Infinity);

    if (cap < m.min) return null;

    const row = buildRow(aspects.slice(start, start + size), m, cap);

    if (!row) return null;

    rows.push(row);
    used += row.height + (index > 0 ? m.gap : 0);
    start += size;
  }

  return { kind: 'rows', rows } satisfies RowsPlan;
}

/**
 * Тот же план, но ряды ниже в `factor` раз. Плитки при этом подрезаются,
 * насколько позволяет `MAX_CROP`: десяток портретов иначе вырастает выше
 * экрана. Какая степень лучше, решает `layoutCost`.
 */
function shrinkRows(plan: RowsPlan | null, m: Metrics, factor: number): RowsPlan | null {
  if (!plan || factor >= 1) return null;

  return {
    kind: 'rows',
    rows: plan.rows.map((row) => ({ ...row, height: Math.max(m.min, row.height * factor) })),
  };
}

/** Во сколько раз ужать ряды плана, чтобы альбом встал ровно в желанную высоту. */
function factorToTarget(plan: RowsPlan | null, m: Metrics, target: number): number {
  if (!plan) return 1;

  const gaps = m.gap * (plan.rows.length - 1);

  return (target - gaps) / plan.rows.reduce((sum, row) => sum + row.height, 0);
}

function columnPlan(aspects: number[], m: Metrics): ColumnPlan | null {
  const [first, ...rest] = aspects;
  const count = rest.length;
  const gaps = m.gap * (count - 1);
  // Сумма «высот на единицу ширины» правой колонки.
  const inverse = rest.reduce((sum, a) => sum + 1 / a, 0);

  // Без обрезки: левая плитка той же высоты, что и колонка, в своих пропорциях.
  let rightWidth =
    m.width - m.gap - (first * ((m.width - m.gap) * inverse + gaps)) / (1 + first * inverse);

  rightWidth = Math.max(m.min, Math.min(rightWidth, m.width - m.gap - m.min));

  const minHeight = count * m.min + gaps;

  if (minHeight > m.maxHeight) return null;

  const height = Math.max(minHeight, Math.min(rightWidth * inverse + gaps, m.maxHeight));
  const rightHeights = rest.map((a) => ((height - gaps) * (1 / a)) / inverse);

  // Столбик из плиток разной высоты: самые низкие дотягиваются до минимума.
  const short = rightHeights.filter((h) => h < m.min).length;

  if (short > 0) {
    const spare = height - gaps - short * m.min;
    const tallSum = rightHeights.filter((h) => h >= m.min).reduce((s, h) => s + h, 0);

    for (let i = 0; i < count; i++) {
      rightHeights[i] = rightHeights[i] < m.min ? m.min : (rightHeights[i] / tallSum) * spare;
    }
  }

  return { kind: 'column', leftWidth: m.width - m.gap - rightWidth, height, rightHeights };
}

function score(plan: Plan | null, aspects: number[], m: Metrics): Scored | null {
  if (!plan) return null;

  const crops: number[] = [];
  let height: number;

  if (plan.kind === 'rows') {
    let index = 0;

    for (const row of plan.rows) {
      for (const width of row.widths) {
        if (width < m.min - 0.5) return null;
        crops.push(cropOf(width, row.height, aspects[index++]));
      }
    }

    height = plan.rows.reduce((sum, row) => sum + row.height, 0) + m.gap * (plan.rows.length - 1);
  } else {
    const rightWidth = m.width - m.gap - plan.leftWidth;

    if (plan.leftWidth < m.min || rightWidth < m.min) return null;
    if (plan.rightHeights.some((h) => h < m.min - 0.5)) return null;

    crops.push(cropOf(plan.leftWidth, plan.height, aspects[0]));
    plan.rightHeights.forEach((h, i) => crops.push(cropOf(rightWidth, h, aspects[i + 1])));
    height = plan.height;
  }

  if (crops.some((crop) => crop > MAX_CROP)) return null;

  return { plan, crops, height };
}

/**
 * Цена раскладки большого альбома. Меньше — лучше. Слагаемые подобраны на
 * глаз по стенду `media-lab`, веса — в долях ширины альбома.
 */
function layoutCost(scored: Scored, m: Metrics, target: number): number {
  // Лишняя высота вдвое дороже недостающей: высокий альбом листать, низкий — нет.
  const over = scored.height - target;
  const heightCost = (over > 0 ? 2 * over : -over) / m.width;
  const cropCost = scored.crops.reduce((sum, c) => sum + c, 0) / scored.crops.length;
  let shapeCost = 0;

  if (scored.plan.kind === 'rows') {
    const counts = scored.plan.rows.map((row) => row.widths.length);
    const heights = scored.plan.rows.map((row) => row.height);

    // Ряд, где плиток заметно больше, чем в соседнем, читается как сбой.
    for (let i = 1; i < counts.length; i++) {
      if (Math.abs(counts[i] - counts[i - 1]) >= 2) shapeCost += 0.3;
    }

    // Верхний ряд с плитками мельче нижних выглядит перевёрнутым.
    if (counts.length > 1 && counts[0] > Math.min(...counts.slice(1))) shapeCost += 0.1;

    shapeCost += 0.6 * Math.log(Math.max(...heights) / Math.min(...heights));
  }

  return heightCost + 1.5 * cropCost + shapeCost;
}

/** Все разбиения `count` файлов на `1..MAX_ROWS` рядов по `1..MAX_ROW_SIZE`. */
function rowPartitions(count: number): number[][] {
  const result: number[][] = [];

  const walk = (left: number, acc: number[]) => {
    if (left === 0) {
      result.push(acc);
      return;
    }

    if (acc.length === MAX_ROWS) return;

    for (let size = 1; size <= Math.min(MAX_ROW_SIZE, left); size++)
      walk(left - size, [...acc, size]);
  };

  walk(count, []);

  return result;
}

function searchBest(aspects: number[], m: Metrics, target: number): Scored | null {
  let best: Scored | null = null;
  let bestCost = Infinity;

  const candidates: (Plan | null)[] = rowPartitions(aspects.length).flatMap((sizes) => {
    const plan = rowsPlan(aspects, sizes, m);

    return [
      plan,
      ...SHRINK_FACTORS.map((factor) => shrinkRows(plan, m, factor)),
      shrinkRows(plan, m, factorToTarget(plan, m, target)),
    ];
  });

  if (aspects.length <= 4) candidates.push(columnPlan(aspects, m));

  for (const plan of candidates) {
    const scored = score(plan, aspects, m);

    if (!scored) continue;

    const cost = layoutCost(scored, m, target);

    if (cost < bestCost) {
      best = scored;
      bestCost = cost;
    }
  }

  return best;
}

type Shape = 'wide' | 'square' | 'narrow';

function shapeOf(aspect: number): Shape {
  if (aspect > 1.2) return 'wide';
  if (aspect < 0.8) return 'narrow';
  return 'square';
}

/** Явные правила Telegram для 2–4 файлов. */
function telegramPlan(aspects: number[], m: Metrics): Plan | null {
  const shapes = aspects.map(shapeOf);
  const average = aspects.reduce((sum, a) => sum + a, 0) / aspects.length;
  // Предел, на котором первый файл сверху ещё не съедает весь альбом.
  const topCap = m.maxHeight * TOP_ROW_SHARE;

  if (aspects.length === 2) {
    const [a, b] = aspects;

    // Два широких кадра с близкими пропорциями: рядом они стали бы полосками.
    if (shapes.every((s) => s === 'wide') && average > 1.4 && Math.abs(a - b) < 0.2) {
      return rowsPlan(aspects, [1, 1], m);
    }

    return rowsPlan(aspects, [2], m);
  }

  if (aspects.length === 3) {
    return shapes[0] === 'narrow' ? columnPlan(aspects, m) : rowsPlan(aspects, [1, 2], m, topCap);
  }

  return shapes[0] === 'wide' ? rowsPlan(aspects, [1, 3], m, topCap) : columnPlan(aspects, m);
}

// -----------------------------------------------------------------------------
// Перевод в целые пиксели
// -----------------------------------------------------------------------------

/** Отрезки подряд с зазором: края на целых пикселях, последний добирает до `total`. */
function snapRun(lengths: number[], gap: number, total: number): { start: number; size: number }[] {
  const result: { start: number; size: number }[] = [];
  let start = 0;

  lengths.forEach((length, i) => {
    const size = i === lengths.length - 1 ? total - start : Math.round(length);

    result.push({ start, size });
    start += size + gap;
  });

  return result;
}

function snapPlan(plan: Plan, m: Metrics): { tiles: MosaicTile[]; height: number } {
  if (plan.kind === 'rows') {
    const heights = plan.rows.map((row) => Math.round(row.height));
    const total = heights.reduce((sum, h) => sum + h, 0) + m.gap * (heights.length - 1);
    const ys = snapRun(heights, m.gap, total);
    const tiles = plan.rows.flatMap((row, r) =>
      snapRun(row.widths, m.gap, m.width).map(({ start, size }) => ({
        x: start,
        y: ys[r].start,
        width: size,
        height: ys[r].size,
      })),
    );

    return { tiles, height: total };
  }

  const height = Math.round(plan.height);
  const left = Math.round(plan.leftWidth);
  const rightX = left + m.gap;
  const right = snapRun(plan.rightHeights, m.gap, height).map(({ start, size }) => ({
    x: rightX,
    y: start,
    width: m.width - rightX,
    height: size,
  }));

  return { tiles: [{ x: 0, y: 0, width: left, height }, ...right], height };
}

function singleLayout(item: MosaicItem, bounds: MosaicBounds, scale: number): MosaicLayout {
  const maxWidth = Math.round(bounds.maxWidth * scale);
  const maxHeight = Math.round(bounds.maxSingleHeight * scale);
  const minWidth = Math.round(bounds.minSingleWidth * scale);
  // Одиночное медиа вписывается в коробку; панорама не становится полоской,
  // длинный скриншот — щелью.
  const aspect = aspectOf(item, minWidth / maxHeight);

  const width =
    aspect >= maxWidth / maxHeight ? maxWidth : Math.max(minWidth, Math.round(maxHeight * aspect));
  const height = Math.min(maxHeight, Math.round(width / aspect));

  return {
    width: width / scale,
    height: height / scale,
    tiles: [{ x: 0, y: 0, width: width / scale, height: height / scale }],
  };
}

/**
 * Раскладка альбома. Чистая функция: результат зависит только от размеров
 * файлов, границ и плотности экрана, поэтому мемоизируется по ним.
 *
 * @param scale физических пикселей в dp (`PixelRatio.get()`)
 */
export function computeMosaicLayout(
  items: MosaicItem[],
  bounds: MosaicBounds,
  scale: number,
): MosaicLayout {
  if (items.length === 0) return { width: 0, height: 0, tiles: [] };
  if (items.length === 1) return singleLayout(items[0], bounds, scale);

  const minAspect = items.length >= 5 ? MIN_ASPECT_LARGE_ALBUM : MIN_ASPECT;
  const aspects = items.map((item) => aspectOf(item, minAspect));
  const width = Math.round(bounds.maxWidth * scale);
  const m: Metrics = {
    width,
    gap: Math.max(1, Math.round(MOSAIC_GAP * scale)),
    min: Math.round(MIN_TILE * scale),
    maxHeight: Math.round(width * (items.length <= 4 ? MAX_HEIGHT_RATIO : 2)),
  };
  const target = width * TARGET_HEIGHT_RATIO;

  const scored =
    (items.length <= 4 ? score(telegramPlan(aspects, m), aspects, m) : null) ??
    searchBest(aspects, m, target) ??
    // Не нашлось ничего годного (очень узкий экран): ряды по два, как есть.
    score(rowsPlan(aspects, chunk(items.length, 2), { ...m, min: 1 }), aspects, { ...m, min: 1 });

  const { tiles, height } = snapPlan(scored!.plan, m);

  return {
    width: width / scale,
    height: height / scale,
    tiles: tiles.map((tile) => ({
      x: tile.x / scale,
      y: tile.y / scale,
      width: tile.width / scale,
      height: tile.height / scale,
    })),
  };
}

function chunk(count: number, size: number): number[] {
  return Array.from({ length: Math.ceil(count / size) }, (_, i) =>
    Math.min(size, count - i * size),
  );
}
