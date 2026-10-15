import { infoGeometry, snapTarget, syncedOffset } from './geometry';

const withPhoto = infoGeometry({ width: 400, insetTop: 24, hasActions: true, expandable: true });
const noPhoto = infoGeometry({ width: 400, insetTop: 24, hasActions: false, expandable: false });

describe('infoGeometry', () => {
  it('opens a photo into a full-width square and nothing without one', () => {
    expect(withPhoto.expandedHeight).toBeGreaterThanOrEqual(400);
    expect(withPhoto.expand).toBe(withPhoto.expandedHeight - withPhoto.heroHeight);
    expect(noPhoto.expand).toBe(0);
    expect(noPhoto.expandedHeight).toBe(noPhoto.heroHeight);
  });

  it('puts the action row under the name, and leaves room for it only when there are actions', () => {
    expect(withPhoto.actionsTop).toBeGreaterThan(withPhoto.nameTop);
    expect(withPhoto.heroHeight).toBeGreaterThan(noPhoto.heroHeight);
  });
});

describe('snapTarget', () => {
  const { expand, collapse, expandThreshold } = withPhoto;

  it('keeps the photo open once pulled past the threshold, springs back otherwise', () => {
    expect(snapTarget(expand - expandThreshold - 1, withPhoto, false)).toBe(0);
    expect(snapTarget(expand - expandThreshold + 5, withPhoto, false)).toBe(expand);
  });

  it('closes an open photo from its own side of the threshold', () => {
    expect(snapTarget(expandThreshold + 5, withPhoto, true)).toBe(expand);
    expect(snapTarget(expandThreshold - 5, withPhoto, true)).toBe(0);
  });

  it('never leaves the header half-collapsed', () => {
    expect(snapTarget(expand + collapse * 0.3, withPhoto, false)).toBe(expand);
    expect(snapTarget(expand + collapse * 0.7, withPhoto, false)).toBe(expand + collapse);
  });

  it('leaves the rest alone: settled states and the scrolled content', () => {
    expect(snapTarget(0, withPhoto, true)).toBeNull();
    expect(snapTarget(expand, withPhoto, false)).toBeNull();
    expect(snapTarget(expand + collapse + 300, withPhoto, false)).toBeNull();
  });
});

describe('syncedOffset', () => {
  it('moves a neighbouring tab to where the header is until the tabs stick', () => {
    expect(syncedOffset(120, 900, 500)).toBe(120);
  });

  it('keeps a neighbour where it was once the tabs stick, but not above the stick point', () => {
    expect(syncedOffset(800, 900, 500)).toBe(900);
    expect(syncedOffset(800, 100, 500)).toBe(500);
  });
});
