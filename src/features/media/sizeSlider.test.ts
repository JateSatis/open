import { dragSize, sizeRange, thumbCenter } from './sizeSlider';

import { Sizes } from '@/theme';

/** Ширина клина на высоте `y` от верха. */
const wedge = (y: number) =>
  Sizes.drawSliderNarrow +
  (Sizes.drawSliderWide - Sizes.drawSliderNarrow) * (1 - y / Sizes.drawSliderHeight);

describe('ползунок толщины', () => {
  const { min, max } = sizeRange();

  it('бегунок любой толщины целиком внутри клина и по высоте не вылезает', () => {
    for (let size = min; size <= max; size += 0.5) {
      const center = thumbCenter(size);

      expect(size).toBeLessThanOrEqual(wedge(center) + 1e-9);
      expect(center - size / 2).toBeGreaterThanOrEqual(0);
      expect(center + size / 2).toBeLessThanOrEqual(Sizes.drawSliderHeight + 1e-9);
    }
  });

  it('толще клина не бывает: верхний предел — ширина клина у верха', () => {
    expect(max).toBeLessThanOrEqual(Sizes.drawSliderWide);
    expect(min).toBeGreaterThanOrEqual(Sizes.drawSliderNarrow);
  });

  it('вверх — толще, до предела', () => {
    expect(dragSize(min, -10)).toBeGreaterThan(min);
    expect(dragSize(min, -10_000)).toBe(max);
    expect(dragSize(max, 10_000)).toBe(min);
  });
});
