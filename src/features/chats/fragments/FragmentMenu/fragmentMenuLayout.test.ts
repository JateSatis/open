import { fragmentMenuLayout } from './fragmentMenuLayout';

const base = {
  handleSpace: 18,
  viewport: { top: 100, bottom: 700 },
  screenWidth: 400,
  width: 300,
  height: 50,
  gap: 8,
};

describe('fragment menu placement', () => {
  it('stands under the selection, below the handles, centred on it', () => {
    expect(
      fragmentMenuLayout({ ...base, selection: { x: 150, y: 300, width: 100, height: 20 } }),
    ).toEqual({ left: 50, top: 346, above: false });
  });

  it('goes above the selection when it would run into the composer', () => {
    expect(
      fragmentMenuLayout({ ...base, selection: { x: 150, y: 640, width: 100, height: 20 } }),
    ).toEqual({ left: 50, top: 582, above: true });
  });

  it('stays on screen at the right and left edges', () => {
    expect(
      fragmentMenuLayout({ ...base, selection: { x: 360, y: 300, width: 30, height: 20 } }).left,
    ).toBe(92);
    expect(
      fragmentMenuLayout({ ...base, selection: { x: 0, y: 300, width: 20, height: 20 } }).left,
    ).toBe(8);
  });

  it('keeps inside the list when the selection fills it', () => {
    expect(
      fragmentMenuLayout({ ...base, selection: { x: 0, y: 120, width: 400, height: 560 } }),
    ).toEqual({ left: 50, top: 642, above: false });
  });
});
