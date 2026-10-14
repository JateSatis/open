import { boundsOf, caretAt, charAt, offsetAt, rangeRects } from './textGeometry';

import type { TextGeometry } from '../../../../modules/text-geometry';

// «hello world » на первой строке (пробел на переносе), «foo» на второй;
// символ — 10 dp, строка — 20 dp.
const text = 'hello world foo';
const geometry: TextGeometry = {
  text,
  width: 200,
  height: 40,
  lines: [
    { start: 0, end: 12, top: 0, bottom: 20, baseline: 15, left: 0, right: 110 },
    { start: 12, end: 15, top: 20, bottom: 40, baseline: 35, left: 0, right: 30 },
  ],
  xs: [...text].map((_, i) => (i < 12 ? i * 10 : (i - 12) * 10)),
};

describe('point to offset', () => {
  it('finds the nearest boundary on the line under the finger', () => {
    expect(offsetAt(geometry, 23, 10)).toBe(2);
    expect(offsetAt(geometry, 27, 10)).toBe(3);
    expect(offsetAt(geometry, 14, 30)).toBe(13);
  });

  it('misses outside the text without clamping', () => {
    expect(offsetAt(geometry, 150, 30)).toBeNull();
    expect(offsetAt(geometry, 10, 50)).toBeNull();
  });

  it('clamps a dragged handle to the text', () => {
    expect(offsetAt(geometry, 150, 30, true)).toBe(15);
    expect(offsetAt(geometry, 10, -20, true)).toBe(0);
    expect(offsetAt(geometry, 10, 90, true)).toBe(15);
  });

  it('keeps the right edge of a wrapped line on that line', () => {
    expect(offsetAt(geometry, 109, 10)).toBe(11);
  });

  it('tells the glyph under the finger, or none', () => {
    expect(charAt(geometry, 15, 10)).toBe(1);
    expect(charAt(geometry, 5, 30)).toBe(12);
    expect(charAt(geometry, 180, 10)).toBeNull();
  });
});

describe('range to rects', () => {
  it('covers one word on one line', () => {
    expect(rangeRects(geometry, 6, 11)).toEqual([{ x: 60, y: 0, width: 50, height: 20 }]);
  });

  it('paints each line only up to its last glyph — no tail, no gap', () => {
    expect(rangeRects(geometry, 6, 14)).toEqual([
      { x: 60, y: 0, width: 50, height: 20 },
      { x: 0, y: 20, width: 20, height: 20 },
    ]);
  });

  it('is empty for an empty range', () => {
    expect(rangeRects(geometry, 4, 4)).toEqual([]);
  });

  it('frames all the rects at once', () => {
    expect(boundsOf(rangeRects(geometry, 6, 14))).toEqual({ x: 0, y: 0, width: 110, height: 40 });
    expect(boundsOf([])).toBeNull();
  });
});

describe('handles', () => {
  it('puts the start handle before the first glyph and the end one after the last', () => {
    expect(caretAt(geometry, 6, 'start')).toEqual({ x: 60, top: 0, bottom: 20 });
    expect(caretAt(geometry, 11, 'end')).toEqual({ x: 110, top: 0, bottom: 20 });
    expect(caretAt(geometry, 14, 'end')).toEqual({ x: 20, top: 20, bottom: 40 });
  });

  it('keeps the end handle on the line of the last selected glyph at a wrap', () => {
    expect(caretAt(geometry, 12, 'end')).toEqual({ x: 110, top: 0, bottom: 20 });
  });
});
