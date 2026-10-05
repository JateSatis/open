import { panelGeometry } from './panelGeometry';

const WINDOW = 800;
const INSET = 24;

describe('panelGeometry', () => {
  it('puts the top of the sheet at a quarter of the screen', () => {
    const { top, height } = panelGeometry(WINDOW, INSET, 1);

    expect(top).toBe(WINDOW * 0.25);
    expect(height).toBe(WINDOW * 0.75);
  });

  it('never goes above the status bar', () => {
    expect(panelGeometry(80, INSET, 1).top).toBe(INSET);
  });

  it('closes past a fifth of the sheet', () => {
    const { height, dismissDistance } = panelGeometry(WINDOW, INSET, 1);

    expect(dismissDistance).toBe(height * 0.2);
  });

  it('snaps the top to whole physical pixels', () => {
    const { top } = panelGeometry(801, INSET, 3);

    expect(Math.round(top * 3)).toBe(top * 3);
  });
});
