import { panelSnaps, resolvePanelSnap, snapTop } from './panelGeometry';

const WINDOW = 800;
const TOP_INSET = 100;

describe('panelSnaps', () => {
  it('puts the bottom of the message at the middle of the screen in the half position', () => {
    const snaps = panelSnaps(WINDOW, TOP_INSET, 150);

    expect(snaps.half).toBe(250);
    expect(snaps.half! + 150).toBe(WINDOW / 2);
  });

  it('never opens higher than 80% of the screen', () => {
    expect(panelSnaps(WINDOW, TOP_INSET, 150).full).toBe(160);
  });

  it('stays under the screen header if it is lower than 80%', () => {
    expect(panelSnaps(WINDOW, 200, 100).full).toBe(200);
  });

  it('has no half for a tall message — it opens full', () => {
    expect(panelSnaps(WINDOW, TOP_INSET, 380).half).toBeNull();
  });
});

describe('resolvePanelSnap', () => {
  const snaps = panelSnaps(WINDOW, TOP_INSET, 150); // full 160, half 250, closed 800

  it('closes on a fling down from the full position instead of stopping at half', () => {
    expect(resolvePanelSnap(snaps.full + 20, 1200, snaps)).toBe('closed');
  });

  it('expands to full on a fling up', () => {
    expect(resolvePanelSnap(snaps.half! - 10, -1200, snaps)).toBe('full');
  });

  it('a slow drag goes to the nearest position', () => {
    expect(resolvePanelSnap(190, 0, snaps)).toBe('full');
    expect(resolvePanelSnap(230, 0, snaps)).toBe('half');
    expect(resolvePanelSnap(300, 0, snaps)).toBe('half');
  });

  it('a slow drag closes only past a fifth of the sheet below its lowest position', () => {
    // Ниже половины на (800 - 250) * 0.2 = 110.
    expect(resolvePanelSnap(355, 0, snaps)).toBe('half');
    expect(resolvePanelSnap(365, 0, snaps)).toBe('closed');
  });

  it('without a half a slow drag returns to full or closes', () => {
    const tall = panelSnaps(WINDOW, TOP_INSET, 380);

    // Ниже полного на (800 - 160) * 0.2 = 128.
    expect(resolvePanelSnap(280, 0, tall)).toBe('full');
    expect(resolvePanelSnap(300, 0, tall)).toBe('closed');
  });

  it('snapTop falls back to full when there is no half', () => {
    expect(snapTop('half', panelSnaps(WINDOW, TOP_INSET, 380))).toBe(160);
  });
});
