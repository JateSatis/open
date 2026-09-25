import { followFinger, startFinger, type FingerState } from './followFinger';

/** Прогоняет жест кадр за кадром и возвращает, где был шит на каждом кадре. */
function drag(start: FingerState, frames: { y: number; scroll: number }[]) {
  let state = start;

  return frames.map(({ y, scroll }) => {
    const step = followFinger(state, y, scroll);
    state = step;
    return step.dismissY;
  });
}

describe('followFinger', () => {
  it('leaves the movement to the list while the list is scrolled', () => {
    expect(
      drag(startFinger(0, 0), [
        { y: 20, scroll: 300 },
        { y: 60, scroll: 260 },
      ]),
    ).toEqual([null, null]);
  });

  it('hands one continuous downward drag from the list to the sheet the moment the list hits the top', () => {
    // Шит развёрнут, палец идёт вниз, не отрываясь: сначала едет список, в
    // нуле его сменяет шит — и едет дальше, до закрытия.
    expect(
      drag(startFinger(0, 0), [
        { y: 100, scroll: 200 },
        { y: 300, scroll: 0 },
        { y: 400, scroll: 0 },
        { y: 600, scroll: 0 },
      ]),
    ).toEqual([null, 0, 100, 300]);
  });

  it('gives the movement back to the list once the sheet is back in place', () => {
    const frames = drag(startFinger(0, 0), [
      { y: 50, scroll: 0 },
      { y: 150, scroll: 0 },
      { y: 60, scroll: 0 },
      { y: 20, scroll: 0 },
      { y: -40, scroll: 0 },
    ]);

    expect(frames).toEqual([0, 100, 10, 0, null]);
  });

  it('does not take an upward drag at the top: that one expands the sheet', () => {
    expect(drag(startFinger(0, 0), [{ y: -30, scroll: 0 }])).toEqual([null]);
  });

  it('picks the sheet up where the finger caught it while it was still moving', () => {
    // Шит ещё выезжал и был в 200 от места: палец ведёт его оттуда же.
    expect(drag(startFinger(0, 200), [{ y: 30, scroll: 0 }, { y: -50, scroll: 0 }])).toEqual([
      230, 150,
    ]);
  });
});
