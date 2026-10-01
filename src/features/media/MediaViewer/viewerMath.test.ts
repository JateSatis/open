import {
  clampWithRubber,
  dismissOpacity,
  fittedSize,
  panBound,
  resolveDismiss,
  resolvePage,
  rubberBand,
  zoomAround,
} from './viewerMath';

const SCREEN = { width: 400, height: 800 };

describe('viewer zoom', () => {
  it('keeps the point between the fingers under the fingers', () => {
    // Точка в 100 dp правее центра, увеличение вдвое: картинка сдвигается на
    // 100 влево, и та же точка снова в 100 dp от центра.
    const translation = zoomAround(100, 0, 1, 2);

    expect(translation).toBe(-100);
    expect(translation + 100 * 2).toBe(100);
  });

  it('does not let the edge leave the screen edge', () => {
    expect(panBound(400, 400, 1)).toBe(0);
    expect(panBound(400, 400, 2)).toBe(200);
  });

  it('resists past the edge instead of stopping dead', () => {
    const past = clampWithRubber(260, 200, 400);

    expect(past).toBeGreaterThan(200);
    expect(past).toBeLessThan(260);
    expect(clampWithRubber(150, 200, 400)).toBe(150);
    expect(rubberBand(0, 400)).toBe(0);
  });

  it('fits a landscape photo by width and a portrait one by height', () => {
    expect(fittedSize({ width: 800, height: 400 }, SCREEN)).toEqual({ width: 400, height: 200 });
    expect(fittedSize({ width: 300, height: 1200 }, SCREEN)).toEqual({ width: 200, height: 800 });
    expect(fittedSize({ width: null, height: null }, SCREEN)).toEqual(SCREEN);
  });
});

describe('viewer paging', () => {
  it('turns the page after a quarter of the screen or a fling', () => {
    expect(resolvePage(1, 3, -120, 0, 400)).toBe(2);
    expect(resolvePage(1, 3, 120, 0, 400)).toBe(0);
    expect(resolvePage(1, 3, -20, -1200, 400)).toBe(2);
    expect(resolvePage(1, 3, -60, 0, 400)).toBe(1);
  });

  it('does not page past the first or the last', () => {
    expect(resolvePage(0, 3, 300, 0, 400)).toBe(0);
    expect(resolvePage(2, 3, -300, 0, 400)).toBe(2);
  });
});

describe('viewer dismiss', () => {
  it('closes up or down past the threshold or on a fling, otherwise springs back', () => {
    expect(resolveDismiss(150, 0, 800)).toBe(1);
    expect(resolveDismiss(-150, 0, 800)).toBe(-1);
    expect(resolveDismiss(20, 1500, 800)).toBe(1);
    expect(resolveDismiss(60, 0, 800)).toBe(0);
  });

  it('fades the background as the media is dragged away', () => {
    expect(dismissOpacity(0, 900)).toBe(1);
    expect(dismissOpacity(150, 900)).toBeCloseTo(0.5);
    expect(dismissOpacity(-600, 900)).toBe(0);
  });
});
