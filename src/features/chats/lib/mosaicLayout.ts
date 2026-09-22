/**
 * Раскладка альбома в один прямоугольник — как в Telegram: каждая плитка
 * сохраняет свои реальные пропорции, но вместе они всегда заполняют ровный
 * прямоугольник шириной `containerWidth`. Это приближение, не буквальный
 * алгоритм Telegram: явные раскладки для 1–4 плиток и построчная упаковка
 * («justified layout», как в галереях) для альбомов побольше.
 */

export type MosaicItem = {
  width: number;
  height: number;
};

export type MosaicTile = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Меньше — совсем узкая полоска, больше — плитка на весь экран. Телеграм держится в этих же рамках. */
const MIN_ASPECT_RATIO = 0.6;
const MAX_ASPECT_RATIO = 1.8;
const GAP = 2;

function aspectRatioOf(item: MosaicItem): number {
  if (item.height <= 0) return 1;

  const ratio = item.width / item.height;

  return Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, ratio));
}

function isPortrait(item: MosaicItem): boolean {
  return item.height > item.width;
}

/**
 * Ряд плиток, растянутый по общей высоте так, чтобы сумма ширин совпала с
 * `containerWidth` — классическая justified-раскладка фотогалерей.
 */
function layoutJustifiedRow(row: MosaicItem[], containerWidth: number, y: number): MosaicTile[] {
  const ratios = row.map(aspectRatioOf);
  const summedRatio = ratios.reduce((sum, ratio) => sum + ratio, 0);
  const rowHeight = (containerWidth - GAP * (row.length - 1)) / summedRatio;

  let x = 0;

  return ratios.map((ratio, index) => {
    const isLast = index === row.length - 1;
    const width = isLast ? containerWidth - x : Math.round(ratio * rowHeight);
    const tile: MosaicTile = { x, y, width, height: Math.round(rowHeight) };

    x += width + GAP;

    return tile;
  });
}

/** Группирует альбом по 3 плитки в ряд (последний ряд — 1, 2 или 3). */
function chunkIntoRows<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }

  // Ряд из одного файла смотрелся бы вытянутой полосой — переносим его
  // последний элемент в предыдущий ряд, если тот ещё не переполнен.
  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 2].length < size) {
    const [orphan] = rows.pop()!;
    rows[rows.length - 1].push(orphan);
  }

  return rows;
}

function layoutJustified(items: MosaicItem[], containerWidth: number): MosaicTile[] {
  const rows = chunkIntoRows(items, 3);
  const tiles: MosaicTile[] = [];
  let y = 0;

  for (const row of rows) {
    const rowTiles = layoutJustifiedRow(row, containerWidth, y);

    tiles.push(...rowTiles);
    y += rowTiles[0].height + GAP;
  }

  return tiles;
}

export function computeMosaicLayout(items: MosaicItem[], containerWidth: number): MosaicTile[] {
  if (items.length === 0) return [];

  if (items.length === 1) {
    const ratio = aspectRatioOf(items[0]);

    return [{ x: 0, y: 0, width: containerWidth, height: Math.round(containerWidth / ratio) }];
  }

  if (items.length === 2) {
    const bothPortrait = items.every(isPortrait);

    if (bothPortrait) {
      const halfWidth = (containerWidth - GAP) / 2;
      const height = Math.round(halfWidth / Math.max(...items.map(aspectRatioOf)));

      return [
        { x: 0, y: 0, width: Math.round(halfWidth), height },
        { x: Math.round(halfWidth) + GAP, y: 0, width: Math.round(halfWidth), height },
      ];
    }

    // Пара, где хотя бы один кадр не портретный, встаёт друг под другом —
    // бок о бок два широких кадра дали бы слишком приплюснутые плитки.
    const firstHeight = Math.round(containerWidth / aspectRatioOf(items[0]));
    const secondHeight = Math.round(containerWidth / aspectRatioOf(items[1]));

    return [
      { x: 0, y: 0, width: containerWidth, height: firstHeight },
      { x: 0, y: firstHeight + GAP, width: containerWidth, height: secondHeight },
    ];
  }

  if (items.length === 3) {
    const halfWidth = Math.round((containerWidth - GAP) / 2);
    const rightWidth = containerWidth - halfWidth - GAP;
    const leftHeight = Math.round(halfWidth / aspectRatioOf(items[0]));
    const rightTileHeight = Math.round((leftHeight - GAP) / 2);

    return [
      { x: 0, y: 0, width: halfWidth, height: leftHeight },
      { x: halfWidth + GAP, y: 0, width: rightWidth, height: rightTileHeight },
      { x: halfWidth + GAP, y: rightTileHeight + GAP, width: rightWidth, height: rightTileHeight },
    ];
  }

  if (items.length === 4) {
    const halfWidth = Math.round((containerWidth - GAP) / 2);
    const rightWidth = containerWidth - halfWidth - GAP;
    const topHeight = Math.round(halfWidth / aspectRatioOf(items[0]));
    const bottomHeight = Math.round(rightWidth / aspectRatioOf(items[3]));

    return [
      { x: 0, y: 0, width: halfWidth, height: topHeight },
      { x: halfWidth + GAP, y: 0, width: rightWidth, height: topHeight },
      { x: 0, y: topHeight + GAP, width: halfWidth, height: bottomHeight },
      { x: halfWidth + GAP, y: topHeight + GAP, width: rightWidth, height: bottomHeight },
    ];
  }

  return layoutJustified(items, containerWidth);
}
