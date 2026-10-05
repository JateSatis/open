import { panelGeometry } from './panelGeometry';

const WINDOW = 800;
const INSET = 24;

describe('panelGeometry', () => {
  it('puts the bottom of the message at 20% of the screen in the top position', () => {
    const { top } = panelGeometry(WINDOW, INSET, 100, 1);

    expect(top + 100).toBe(WINDOW * 0.2);
  });

  it('puts the bottom of the message at the middle of the screen in the half position', () => {
    const { top, travel } = panelGeometry(WINDOW, INSET, 100, 1);

    expect(top + travel + 100).toBe(WINDOW / 2);
  });

  it('gives the comments 80% of the screen in the top position', () => {
    const { top, listHeight } = panelGeometry(WINDOW, INSET, 100, 1);

    expect(listHeight - 100).toBe(WINDOW * 0.8);
    expect(top + listHeight).toBe(WINDOW);
  });

  it('never goes above the status bar with a tall message', () => {
    const { top, travel } = panelGeometry(WINDOW, INSET, 300, 1);

    expect(top).toBe(INSET);
    expect(top + travel + 300).toBe(WINDOW / 2);
  });

  it('opens straight to the top when the middle is too close to it', () => {
    expect(panelGeometry(WINDOW, INSET, 360, 1).travel).toBe(0);
  });

  it('closes past a fifth of the half-open sheet', () => {
    const { halfHeight, dismissDistance } = panelGeometry(WINDOW, INSET, 100, 1);

    expect(halfHeight).toBe(WINDOW / 2 + 100);
    expect(dismissDistance).toBe(halfHeight * 0.2);
  });

  it('snaps positions to whole physical pixels', () => {
    const { top, travel } = panelGeometry(801, INSET, 100.3, 3);

    expect(Math.round(top * 3)).toBe(top * 3);
    expect(Math.round(travel * 3)).toBeCloseTo(travel * 3, 6);
  });
});
