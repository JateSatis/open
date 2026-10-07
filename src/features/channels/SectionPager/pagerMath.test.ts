import { dragPosition, resolveSection, SECTION_FLING_VELOCITY } from './pagerMath';

describe('dragPosition', () => {
  it('follows the finger: a swipe left by half the width is half way to the next section', () => {
    expect(dragPosition(0, -200, 400, 2)).toBeCloseTo(0.5);
    expect(dragPosition(1, 100, 400, 2)).toBeCloseTo(0.75);
  });

  it('resists past the first and the last section', () => {
    expect(dragPosition(0, 200, 400, 2)).toBeGreaterThan(-0.5);
    expect(dragPosition(0, 200, 400, 2)).toBeLessThan(0);
    expect(dragPosition(1, -200, 400, 2)).toBeLessThan(1.5);
  });
});

describe('resolveSection', () => {
  it('settles a slow gesture at the nearest section', () => {
    expect(resolveSection(0.4, 0, 2)).toBe(0);
    expect(resolveSection(0.6, 0, 2)).toBe(1);
  });

  it('switches on a fling even after a short drag', () => {
    expect(resolveSection(0.1, -SECTION_FLING_VELOCITY - 1, 2)).toBe(1);
    expect(resolveSection(0.9, SECTION_FLING_VELOCITY + 1, 2)).toBe(0);
  });

  it('never leaves the sections', () => {
    expect(resolveSection(1.1, -2000, 2)).toBe(1);
    expect(resolveSection(-0.1, 2000, 2)).toBe(0);
  });
});
