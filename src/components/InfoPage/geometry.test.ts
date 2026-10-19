import { infoGeometry, snapTarget, syncedOffset, titleProgress } from './geometry';

const withActions = infoGeometry({ width: 400, insetTop: 24, hasActions: true });
const noActions = infoGeometry({ width: 400, insetTop: 24, hasActions: false });
const narrow = infoGeometry({ width: 200, insetTop: 24, hasActions: true });

describe('infoGeometry', () => {
  it('starts with a full-width photo, at least square', () => {
    expect(withActions.heroHeight).toBe(400);
    expect(noActions.heroHeight).toBe(400);
  });

  it('keeps the name and actions clear of the bar on a narrow screen', () => {
    expect(narrow.heroHeight).toBeGreaterThan(200);
    expect(narrow.nameTop).toBeGreaterThan(narrow.barBottom);
  });

  it('puts the name at the bottom of the photo, above the actions when there are any', () => {
    expect(withActions.actionsTop).toBeGreaterThan(withActions.nameTop);
    expect(noActions.nameTop).toBeGreaterThan(withActions.nameTop);
    expect(withActions.actionsTop).toBeLessThan(withActions.heroHeight);
  });

  it('collapses once the photo bottom reaches the bar', () => {
    expect(withActions.collapse).toBe(withActions.heroHeight - withActions.barBottom);
  });
});

describe('titleProgress', () => {
  const { titleStart, titleShift, nameTop, barBottom, collapse } = withActions;

  it('keeps the name on the photo while it rides up, and moves it to the bar before it reaches it', () => {
    expect(titleProgress(-50, withActions)).toBe(0);
    expect(titleProgress(0, withActions)).toBe(0);
    expect(titleProgress(titleStart, withActions)).toBe(0);
    expect(titleStart + titleShift).toBe(nameTop - barBottom);
    expect(titleProgress(nameTop - barBottom, withActions)).toBe(1);
    expect(titleProgress(collapse + 500, withActions)).toBe(1);
  });
});

describe('snapTarget', () => {
  const { collapse, titleStart: start, titleShift } = withActions;

  it('never leaves the name halfway between the photo and the bar', () => {
    expect(snapTarget(start + titleShift * 0.3, withActions)).toBe(start);
    expect(snapTarget(start + titleShift * 0.7, withActions)).toBe(start + titleShift);
  });

  it('leaves the rest alone: the rest position, a pull-down, the photo midway and the content', () => {
    expect(snapTarget(0, withActions)).toBeNull();
    expect(snapTarget(-40, withActions)).toBeNull();
    expect(snapTarget(start / 2, withActions)).toBeNull();
    expect(snapTarget(collapse + 300, withActions)).toBeNull();
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
