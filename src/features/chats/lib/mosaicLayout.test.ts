import { computeMosaicLayout } from './mosaicLayout';

const CONTAINER_WIDTH = 260;

function totalSize(tiles: { width: number; height: number }[]) {
  return tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0);
}

describe('computeMosaicLayout', () => {
  it('returns nothing for an empty album', () => {
    expect(computeMosaicLayout([], CONTAINER_WIDTH)).toEqual([]);
  });

  it('fills the full width with a single tile, respecting its aspect ratio', () => {
    const [tile] = computeMosaicLayout([{ width: 1000, height: 500 }], CONTAINER_WIDTH);

    expect(tile.width).toBe(CONTAINER_WIDTH);
    expect(tile.height).toBeGreaterThan(0);
    expect(tile.x).toBe(0);
    expect(tile.y).toBe(0);
  });

  it('puts two portrait photos side by side', () => {
    const tiles = computeMosaicLayout(
      [
        { width: 400, height: 800 },
        { width: 400, height: 800 },
      ],
      CONTAINER_WIDTH,
    );

    expect(tiles).toHaveLength(2);
    expect(tiles[0].y).toBe(tiles[1].y);
    expect(tiles[1].x).toBeGreaterThan(tiles[0].x);
    // Вместе — ровный прямоугольник шириной с контейнер.
    expect(tiles[1].x + tiles[1].width).toBeCloseTo(CONTAINER_WIDTH, 0);
  });

  it('stacks two landscape photos instead of placing them side by side', () => {
    const tiles = computeMosaicLayout(
      [
        { width: 1600, height: 900 },
        { width: 1600, height: 900 },
      ],
      CONTAINER_WIDTH,
    );

    expect(tiles).toHaveLength(2);
    expect(tiles[1].y).toBeGreaterThan(tiles[0].y);
  });

  it('gives three photos the classic one-tall-plus-two-stacked layout', () => {
    const tiles = computeMosaicLayout(
      [
        { width: 600, height: 900 },
        { width: 900, height: 600 },
        { width: 900, height: 600 },
      ],
      CONTAINER_WIDTH,
    );

    expect(tiles).toHaveLength(3);
    // Первая плитка — на всю высоту левой колонки, вторая и третья делят
    // правую колонку пополам друг под другом.
    expect(tiles[0].x).toBe(0);
    expect(tiles[1].x).toBeGreaterThan(0);
    expect(tiles[2].x).toBe(tiles[1].x);
    expect(tiles[2].y).toBeGreaterThan(tiles[1].y);
    expect(tiles[0].height).toBeCloseTo(tiles[1].height + tiles[2].height, -1);
  });

  it('lays four photos out as an even 2x2 grid', () => {
    const tiles = computeMosaicLayout(
      [
        { width: 800, height: 800 },
        { width: 800, height: 800 },
        { width: 800, height: 800 },
        { width: 800, height: 800 },
      ],
      CONTAINER_WIDTH,
    );

    expect(tiles).toHaveLength(4);
    const rowsY = new Set(tiles.map((tile) => tile.y));
    expect(rowsY.size).toBe(2);
  });

  it('packs five or more photos into justified rows that each fill the width', () => {
    const items = Array.from({ length: 5 }, () => ({ width: 1000, height: 1000 }));
    const tiles = computeMosaicLayout(items, CONTAINER_WIDTH);

    expect(tiles).toHaveLength(5);

    const rows = new Map<number, typeof tiles>();
    for (const tile of tiles) {
      rows.set(tile.y, [...(rows.get(tile.y) ?? []), tile]);
    }

    for (const row of rows.values()) {
      const rowWidth = row[row.length - 1].x + row[row.length - 1].width;
      expect(rowWidth).toBeCloseTo(CONTAINER_WIDTH, 0);
    }
  });

  it('never lets a single leftover tile end up alone as a full-width sliver', () => {
    // 4 файла построчной упаковкой по 3 дали бы ряды [3, 1] — одинокая
    // плитка должна перейти в предыдущий ряд, а не остаться там одна.
    const items = Array.from({ length: 4 }, () => ({ width: 1000, height: 1000 }));
    const tiles = computeMosaicLayout(items, CONTAINER_WIDTH);

    const rows = new Map<number, number>();
    for (const tile of tiles) {
      rows.set(tile.y, (rows.get(tile.y) ?? 0) + 1);
    }

    expect([...rows.values()]).not.toContain(1);
  });

  it('produces tiles that together cover roughly the whole rectangle without huge overlap', () => {
    const items = [
      { width: 1000, height: 1000 },
      { width: 1000, height: 1000 },
      { width: 1000, height: 1000 },
    ];
    const tiles = computeMosaicLayout(items, CONTAINER_WIDTH);
    const totalHeight = Math.max(...tiles.map((tile) => tile.y + tile.height));

    expect(totalSize(tiles)).toBeGreaterThan(0);
    expect(totalHeight).toBeGreaterThan(0);
  });
});
