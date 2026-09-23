import { GRID_CELL_PADDING, GRID_COLUMNS, GRID_GAP, cellsToFill, gridGeometry } from './gridLayout';

describe('gridGeometry', () => {
  it('leaves the same gap between cells and at the edges of the screen', () => {
    const width = 360;
    const { cellSize } = gridGeometry(width);

    // Ширина колонки: `FlashList` делит на колонки то, что осталось от
    // экрана после отступов содержимого, и делает это сам — любое другое
    // допущение развалило бы сетку на скролле.
    const columnWidth = (width - GRID_CELL_PADDING * 2) / GRID_COLUMNS;

    expect(cellSize + GRID_CELL_PADDING * 2).toBeCloseTo(columnWidth, 5);
    // Между двумя соседними квадратами — по половине зазора от каждого.
    expect(GRID_CELL_PADDING * 2).toBeCloseTo(GRID_GAP, 5);
  });

  it('keeps the vertical step equal to a cell plus one gap', () => {
    const { cellSize, rowHeight } = gridGeometry(412);

    expect(rowHeight - cellSize).toBeCloseTo(GRID_GAP, 5);
  });

  it('fills a screen with whole rows and one spare', () => {
    const { rowHeight } = gridGeometry(360);
    const cells = cellsToFill(800, rowHeight);

    expect(cells % GRID_COLUMNS).toBe(0);
    // Скелет обязан перекрывать экран, иначе под ним видно то, что за шитом.
    expect((cells / GRID_COLUMNS) * rowHeight).toBeGreaterThan(800);
  });
});
