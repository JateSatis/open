import { GRID_COLUMNS, gridGeometry, rowsToFill, snapToPixels } from './gridLayout';

/** Плотности реальных экранов: целая, дробная и «неудобная». */
const SCREENS = [
  { width: 360, scale: 3 },
  { width: 411.4286, scale: 2.625 },
  { width: 393, scale: 2.75 },
  { width: 412, scale: 3.5 },
];

const isWholePixel = (dp: number, scale: number) =>
  Math.abs(dp * scale - Math.round(dp * scale)) < 1e-6;

describe('gridGeometry', () => {
  it.each(SCREENS)('puts every edge on a whole pixel ($width dp × $scale)', ({ width, scale }) => {
    const { cellSize, gap, pitch, columnLeft } = gridGeometry(width, scale);

    for (const value of [cellSize, gap, pitch, ...columnLeft]) {
      expect(isWholePixel(value, scale)).toBe(true);
    }

    // Глубоко в списке строка стоит на целом пикселе так же, как первая:
    // шаг целый, ошибка не копится.
    expect(isWholePixel(pitch * 999, scale)).toBe(true);
  });

  it.each(SCREENS)('keeps one gap everywhere ($width dp × $scale)', ({ width, scale }) => {
    const { cellSize, gap, pitch, columnLeft } = gridGeometry(width, scale);

    // Между строками — ровно зазор.
    expect(pitch - cellSize).toBeCloseTo(gap, 6);
    // Между колонками — тот же зазор, и у левого края тоже.
    expect(columnLeft[0]).toBeCloseTo(gap, 6);
    for (let i = 1; i < GRID_COLUMNS; i += 1) {
      expect(columnLeft[i] - (columnLeft[i - 1] + cellSize)).toBeCloseTo(gap, 6);
    }
  });

  it.each(SCREENS)('never draws past the screen edge ($width dp × $scale)', ({ width, scale }) => {
    const { width: gridWidth, columnLeft, cellSize, gap } = gridGeometry(width, scale);

    expect(columnLeft[GRID_COLUMNS - 1] + cellSize + gap).toBeCloseTo(gridWidth, 6);
    expect(gridWidth).toBeLessThanOrEqual(width + 1e-6);
  });
});

describe('snapToPixels', () => {
  it('rounds a length to whole physical pixels', () => {
    expect(snapToPixels(22, 2.625) * 2.625).toBeCloseTo(58, 6);
  });
});

describe('rowsToFill', () => {
  it('covers a screen with whole rows and one spare', () => {
    const { pitch } = gridGeometry(360, 3);

    expect(rowsToFill(800, pitch) * pitch).toBeGreaterThan(800 + pitch - 1);
  });
});
