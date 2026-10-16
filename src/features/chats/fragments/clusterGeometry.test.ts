import { clusterPieces } from './clusterGeometry';

import type { TextGeometry } from '../../../../modules/text-geometry';

// «hello world » на первой строке, «foo» на второй; символ — 10 dp, строка — 20 dp.
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

describe('cluster highlight pieces', () => {
  it('goes line by line and rounds only the logical ends of the piece', () => {
    expect(clusterPieces(geometry, [{ id: 'k', start: 6, end: 14 }], 4)).toEqual([
      { clusterId: 'k', rect: { x: 60, y: 0, width: 50, height: 20 }, first: true, last: false },
      { clusterId: 'k', rect: { x: 0, y: 20, width: 20, height: 20 }, first: false, last: true },
    ]);
  });

  it('parts two touching clusters with a gap without touching their ranges', () => {
    const [left, right] = clusterPieces(
      geometry,
      [
        { id: 'b', start: 3, end: 8 },
        { id: 'a', start: 0, end: 3 },
      ],
      4,
    );

    expect(left).toMatchObject({ clusterId: 'a', rect: { x: 0, width: 28 } });
    expect(right).toMatchObject({ clusterId: 'b', rect: { x: 32, width: 48 } });
  });

  it('leaves clusters alone when a space already parts them', () => {
    const pieces = clusterPieces(
      geometry,
      [
        { id: 'a', start: 0, end: 5 },
        { id: 'b', start: 6, end: 11 },
      ],
      4,
    );

    expect(pieces.map((piece) => piece.rect)).toEqual([
      { x: 0, y: 0, width: 50, height: 20 },
      { x: 60, y: 0, width: 50, height: 20 },
    ]);
  });
});
