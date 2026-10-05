import {
  arrivalAt,
  chatOpacity,
  liftProgress,
  liftRest,
  liftTop,
  type LiftLayout,
} from './liftPath';

const SHEET_TOP = 200;
const SHEET_HEIGHT = 600;
const GAP = 8;
const AREA_TOP = 80;

function layout(origin: number, height: number): LiftLayout {
  return {
    origin,
    height,
    rest: liftRest(SHEET_TOP, GAP, height, AREA_TOP),
    sheetTop: SHEET_TOP,
    sheetHeight: SHEET_HEIGHT,
    gap: GAP,
  };
}

describe('liftRest', () => {
  it('puts the bottom of the message just above the sheet', () => {
    expect(liftRest(SHEET_TOP, GAP, 50, AREA_TOP) + 50).toBe(SHEET_TOP - GAP);
  });

  it('stops a tall message at the top of the chat, the rest goes under the sheet', () => {
    expect(liftRest(SHEET_TOP, GAP, 400, AREA_TOP)).toBe(AREA_TOP);
  });
});

describe('a message whose place is below its spot above the sheet', () => {
  const below = layout(500, 50);

  it('starts on its place and stands above the open sheet', () => {
    expect(liftTop(below, SHEET_HEIGHT + SHEET_TOP)).toBe(500);
    expect(liftTop(below, 0)).toBe(SHEET_TOP - GAP - 50);
  });

  it('rides level with the sheet until it reaches its place, then stays', () => {
    expect(liftTop(below, 100)).toBe(SHEET_TOP + 100 - GAP - 50);
    expect(arrivalAt(below)).toBe(500 + 50 + GAP - SHEET_TOP);
    expect(liftTop(below, arrivalAt(below))).toBe(500);
    expect(liftTop(below, arrivalAt(below) + 100)).toBe(500);
  });

  it('a tall one waits at the top of the chat until the sheet catches up', () => {
    const tall = layout(300, 400);

    expect(liftTop(tall, 0)).toBe(AREA_TOP);
    expect(liftTop(tall, 100)).toBe(AREA_TOP);
    expect(liftTop(tall, 400)).toBe(SHEET_TOP + 400 - GAP - 400);
  });
});

describe('a message whose place is above its spot over the sheet', () => {
  const above = layout(30, 50);

  it('moves to its place in proportion to the sheet and arrives before the sheet hides', () => {
    expect(liftTop(above, 0)).toBe(above.rest);
    expect(arrivalAt(above)).toBeLessThan(SHEET_HEIGHT);
    expect(liftTop(above, arrivalAt(above) / 2)).toBeCloseTo((above.rest + 30) / 2);
    expect(liftTop(above, arrivalAt(above))).toBe(30);
    expect(liftTop(above, SHEET_HEIGHT)).toBe(30);
  });
});

describe('liftProgress', () => {
  it('is full above the open sheet and zero on its place', () => {
    const below = layout(500, 50);

    expect(liftProgress(below, 0)).toBe(1);
    expect(liftProgress(below, arrivalAt(below))).toBe(0);
    expect(liftProgress(below, SHEET_HEIGHT)).toBe(0);
  });
});

describe('chatOpacity', () => {
  const above = layout(30, 50);

  it('keeps the chat hidden until the message is back on its place', () => {
    expect(chatOpacity(above, 0, SHEET_HEIGHT)).toBe(0);
    expect(chatOpacity(above, arrivalAt(above), SHEET_HEIGHT)).toBe(0);
  });

  it('then brings it back quickly, before the sheet is gone', () => {
    const shown = arrivalAt(above) + SHEET_HEIGHT * 0.06;

    expect(chatOpacity(above, shown, SHEET_HEIGHT)).toBeCloseTo(0.5);
    expect(chatOpacity(above, SHEET_HEIGHT + SHEET_TOP, SHEET_HEIGHT)).toBe(1);
  });

  it('without a lifted message fades the chat with the sheet itself', () => {
    expect(chatOpacity(null, 0, SHEET_HEIGHT)).toBe(0);
    expect(chatOpacity(null, SHEET_HEIGHT, SHEET_HEIGHT)).toBe(1);
  });
});
