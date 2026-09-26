import {
  computeMosaicLayout,
  MAX_ALBUM_SIZE,
  MIN_TILE,
  MOSAIC_GAP,
  mosaicBounds,
  type MosaicItem,
  type MosaicLayout,
} from './mosaicLayout';

// Телефон 360 dp, плотность 3 — как у проверочного realme; и дробная плотность.
const SCALES = [3, 2.625];
const LIST_WIDTHS = [328, 380, 600];

const portrait = { width: 1080, height: 1920 };
const landscape = { width: 1920, height: 1080 };
const square = { width: 1000, height: 1000 };
const panorama = { width: 4000, height: 900 };
const screenshot = { width: 1080, height: 4800 };
const unknown = { width: null, height: null };

const SHAPES: Record<string, MosaicItem[]> = {
  portrait: [portrait],
  landscape: [landscape],
  square: [square],
  mixed: [portrait, landscape, square],
  extreme: [panorama, screenshot],
  unknown: [unknown],
  mixedWithUnknown: [portrait, unknown, landscape],
};

function album(shape: MosaicItem[], count: number): MosaicItem[] {
  return Array.from({ length: count }, (_, i) => shape[i % shape.length]);
}

/** Сколько пикселей составляет dp: сравнения в целых пикселях, без дробных хвостов. */
const px = (value: number, scale: number) => Math.round(value * scale);

function assertValidMosaic(layout: MosaicLayout, count: number, scale: number) {
  const gap = Math.round(MOSAIC_GAP * scale);
  const width = px(layout.width, scale);
  const height = px(layout.height, scale);

  expect(layout.tiles).toHaveLength(count);

  for (const tile of layout.tiles) {
    // Все края — на целых физических пикселях.
    for (const value of [tile.x, tile.y, tile.width, tile.height]) {
      expect(Math.abs(value * scale - Math.round(value * scale))).toBeLessThan(1e-6);
    }

    expect(tile.x).toBeGreaterThanOrEqual(0);
    expect(tile.y).toBeGreaterThanOrEqual(0);
    expect(px(tile.x + tile.width, scale)).toBeLessThanOrEqual(width);
    expect(px(tile.y + tile.height, scale)).toBeLessThanOrEqual(height);

    if (count > 1) {
      expect(Math.min(tile.width, tile.height)).toBeGreaterThanOrEqual(MIN_TILE - 1 / scale);
    }
  }

  if (count === 1) {
    expect(layout.tiles[0]).toEqual({ x: 0, y: 0, width: layout.width, height: layout.height });
    return;
  }

  // Прямоугольник заполнен целиком и зазоры ровно по `gap`: если каждую
  // плитку, не упирающуюся в край, продлить на `gap` вправо и вниз, такие
  // прямоугольники разбивают альбом без наложений и без дыр.
  const grown = layout.tiles.map((t) => {
    const left = px(t.x, scale);
    const top = px(t.y, scale);
    const right = px(t.x + t.width, scale);
    const bottom = px(t.y + t.height, scale);

    return {
      left,
      top,
      right: right === width ? right : right + gap,
      bottom: bottom === height ? bottom : bottom + gap,
    };
  });

  const area = grown.reduce((sum, r) => sum + (r.right - r.left) * (r.bottom - r.top), 0);

  expect(area).toBe(width * height);

  for (const [i, a] of grown.entries()) {
    for (const b of grown.slice(i + 1)) {
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

      expect(overlap).toBe(false);
    }
  }
}

/** Плитки идут по рядам сверху вниз и слева направо в порядке файлов. */
function assertReadingOrder(layout: MosaicLayout) {
  for (let i = 1; i < layout.tiles.length; i++) {
    const previous = layout.tiles[i - 1];
    const tile = layout.tiles[i];
    const sameRow = tile.y < previous.y + previous.height && previous.y < tile.y + tile.height;

    if (sameRow) {
      // Рядом — значит правее; ниже внутри колонки — значит под предыдущим.
      expect(tile.x > previous.x || tile.y > previous.y).toBe(true);
    } else {
      expect(tile.y).toBeGreaterThan(previous.y);
    }
  }
}

describe('computeMosaicLayout', () => {
  it('returns nothing for an empty album', () => {
    expect(computeMosaicLayout([], mosaicBounds(328), 3).tiles).toEqual([]);
  });

  describe.each(SCALES)('at density %p', (scale) => {
    describe.each(LIST_WIDTHS)('list %p dp wide', (listWidth) => {
      const bounds = mosaicBounds(listWidth);

      it.each(Object.keys(SHAPES))(
        'lays out %s albums of every size into a clean rectangle',
        (shape) => {
          for (let count = 1; count <= MAX_ALBUM_SIZE; count++) {
            const layout = computeMosaicLayout(album(SHAPES[shape], count), bounds, scale);

            assertValidMosaic(layout, count, scale);
            assertReadingOrder(layout);

            // Ширина в границах; альбомы из 2+ файлов — ровно максимальной.
            expect(layout.width).toBeLessThanOrEqual(bounds.maxWidth + 1 / scale);
            if (count > 1) expect(px(layout.width, scale)).toBe(px(bounds.maxWidth, scale));
            else expect(layout.width).toBeGreaterThanOrEqual(bounds.minSingleWidth - 1 / scale);

            // Даже десяток файлов не бывает выше двух ширин альбома.
            expect(layout.height).toBeLessThanOrEqual(layout.width * 2);
          }
        },
      );

      it('is stable: the same album gives the same layout', () => {
        const items = album(SHAPES.mixed, 7);

        expect(computeMosaicLayout(items, bounds, scale)).toEqual(
          computeMosaicLayout(items, bounds, scale),
        );
      });
    });
  });

  describe('single media', () => {
    const bounds = mosaicBounds(328);

    it('fits a portrait into the box by its proportions', () => {
      const layout = computeMosaicLayout([portrait], bounds, 3);

      expect(layout.height).toBeCloseTo(bounds.maxSingleHeight, 0);
      expect(layout.width).toBeLessThan(bounds.maxWidth);
      expect(layout.width / layout.height).toBeCloseTo(1080 / 1920, 1);
    });

    it('does not turn a panorama into a thin strip', () => {
      const layout = computeMosaicLayout([panorama], bounds, 3);

      expect(layout.width).toBeCloseTo(bounds.maxWidth, 0);
      expect(layout.height).toBeGreaterThanOrEqual(bounds.maxWidth / 2 - 1);
    });

    it('does not squeeze a long screenshot into a slit', () => {
      const layout = computeMosaicLayout([screenshot], bounds, 3);

      expect(layout.width).toBeGreaterThanOrEqual(bounds.minSingleWidth - 1);
      expect(layout.height).toBeLessThanOrEqual(bounds.maxSingleHeight);
    });

    it('treats missing dimensions as a square', () => {
      const layout = computeMosaicLayout([unknown], bounds, 3);

      expect(layout.width).toBeCloseTo(layout.height, 0);
    });
  });

  describe('Telegram rules for small albums', () => {
    const bounds = mosaicBounds(328);

    it('stacks two wide shots of similar proportions', () => {
      const { tiles } = computeMosaicLayout([landscape, landscape], bounds, 3);

      expect(tiles[1].y).toBeGreaterThan(tiles[0].y);
      expect(tiles[1].x).toBe(0);
    });

    it('puts other pairs side by side, sharing the width by proportions', () => {
      const { tiles } = computeMosaicLayout([portrait, landscape], bounds, 3);

      expect(tiles[0].y).toBe(tiles[1].y);
      expect(tiles[1].width).toBeGreaterThan(tiles[0].width);
    });

    it('makes a narrow first of three the big tile on the left', () => {
      const { tiles } = computeMosaicLayout([portrait, landscape, landscape], bounds, 3);

      expect(tiles[1].x).toBe(tiles[2].x);
      expect(tiles[1].x).toBeGreaterThan(0);
      expect(tiles[0].height).toBeCloseTo(tiles[2].y + tiles[2].height, 5);
    });

    it('puts a wide first of three on top, two below side by side', () => {
      const { tiles } = computeMosaicLayout([landscape, portrait, portrait], bounds, 3);

      expect(tiles[0].width).toBeCloseTo(bounds.maxWidth, 0);
      expect(tiles[1].y).toBe(tiles[2].y);
      expect(tiles[1].y).toBeGreaterThan(0);
    });

    it('puts a wide first of four on top, three below', () => {
      const { tiles } = computeMosaicLayout([landscape, square, square, square], bounds, 3);

      expect(tiles[0].y).toBe(0);
      expect(new Set(tiles.slice(1).map((t) => t.y)).size).toBe(1);
    });

    it('puts a non-wide first of four on the left, three stacked on the right', () => {
      const { tiles } = computeMosaicLayout([portrait, portrait, portrait, portrait], bounds, 3);

      expect(new Set(tiles.slice(1).map((t) => t.x)).size).toBe(1);
      expect(tiles[1].x).toBeGreaterThan(0);
    });
  });

  it('keeps a large album of portraits well within the screen', () => {
    const bounds = mosaicBounds(328);
    const layout = computeMosaicLayout(album([portrait], 10), bounds, 3);

    expect(layout.height).toBeLessThanOrEqual(bounds.maxWidth * 1.5);
  });
});
