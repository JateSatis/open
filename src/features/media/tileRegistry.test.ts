import type { View } from 'react-native';

import { createTileRegistry, tileVisible } from './tileRegistry';

function viewAt(x: number, y: number, width: number, height: number): View {
  return {
    measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) =>
      callback(x, y, width, height),
  } as unknown as View;
}

describe('createTileRegistry', () => {
  it('measures the tile of a file, with its rounded corners', async () => {
    const tiles = createTileRegistry();
    const corners = { topLeft: 20, topRight: 0, bottomLeft: 0, bottomRight: 0 };

    tiles.register('a', viewAt(10, 20, 100, 50), corners);

    await expect(tiles.measure('a')).resolves.toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      corners,
    });
  });

  it('knows nothing about a tile that is not on screen', async () => {
    await expect(createTileRegistry().measure('missing')).resolves.toBeNull();
  });

  it('keeps a recycled cell registered under the file it shows now', async () => {
    const tiles = createTileRegistry();
    const cell = viewAt(0, 0, 10, 10);

    tiles.register('old', cell);
    tiles.register('new', cell);
    // Клетка отдана другому файлу: снятие старой записи сверяет вью.
    tiles.unregister('old', viewAt(0, 0, 10, 10));

    await expect(tiles.measure('old')).resolves.not.toBeNull();
    tiles.unregister('old', cell);
    await expect(tiles.measure('old')).resolves.toBeNull();
    await expect(tiles.measure('new')).resolves.not.toBeNull();
  });
});

describe('tileVisible', () => {
  const viewport = { x: 0, y: 100, width: 360, height: 500 };

  it('counts a tile as visible when its centre is inside the list', () => {
    expect(tileVisible({ x: 10, y: 80, width: 100, height: 100 }, viewport)).toBe(true);
  });

  it('does not fly into a tile hidden under the header or the composer', () => {
    expect(tileVisible({ x: 10, y: 0, width: 100, height: 100 }, viewport)).toBe(false);
    expect(tileVisible({ x: 10, y: 580, width: 100, height: 100 }, viewport)).toBe(false);
    expect(tileVisible(null, viewport)).toBe(false);
  });

  it('treats the whole screen as the list when it is unknown', () => {
    expect(tileVisible({ x: 10, y: 0, width: 100, height: 100 }, null)).toBe(true);
  });
});
