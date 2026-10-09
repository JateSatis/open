import { BOTTOM, hitEdges, LEFT, movedFrame, RIGHT, TOP } from './cropHandles';
import { crossesZero, formatAngle, rulerAngle } from './rulerMath';

import { Sizes } from '@/theme';

const FRAME = { x: 100, y: 100, width: 300, height: 400 };
const AREA = { x: 0, y: 0, width: 500, height: 700 };

describe('ручки рамки', () => {
  it('угол — две стороны сразу, сторона — одна, середина и даль — ни одной', () => {
    expect(hitEdges(FRAME, 402, 498)).toBe(RIGHT | BOTTOM);
    expect(hitEdges(FRAME, 250, 95)).toBe(TOP);
    expect(hitEdges(FRAME, 98, 300)).toBe(LEFT);
    expect(hitEdges(FRAME, 250, 300)).toBe(0);
    expect(hitEdges(FRAME, 600, 300)).toBe(0);
  });

  it('тянется только та сторона, за которую взяли', () => {
    expect(movedFrame(FRAME, TOP, 30, 50, AREA, 72)).toEqual({
      x: 100,
      y: 150,
      width: 300,
      height: 350,
    });
  });

  it('рамку не сжать меньше предела и не вытянуть за рабочее поле', () => {
    const squeezed = movedFrame(FRAME, RIGHT | BOTTOM, -1000, -1000, AREA, Sizes.cropMinFrame);

    expect(squeezed.width).toBe(Sizes.cropMinFrame);
    expect(squeezed.height).toBe(Sizes.cropMinFrame);

    const stretched = movedFrame(FRAME, LEFT | TOP, -1000, -1000, AREA, Sizes.cropMinFrame);

    expect(stretched.x).toBe(0);
    expect(stretched.y).toBe(0);
  });
});

describe('линейка поворота', () => {
  it('свайп влево крутит по часовой, дальше ±45° не уходит', () => {
    expect(rulerAngle(0, -Sizes.cropRulerStep * 10)).toBeCloseTo(10, 9);
    expect(rulerAngle(0, Sizes.cropRulerStep * 100)).toBe(-45);
    expect(rulerAngle(0, -Sizes.cropRulerStep * 100)).toBe(45);
  });

  it('у нуля прилипает к нулю', () => {
    expect(rulerAngle(0.1, 0)).toBe(0);
  });

  it('вибрация — на проходе через ноль и на приходе в ноль, не на каждом шаге', () => {
    expect(crossesZero(1.2, -0.5)).toBe(true);
    expect(crossesZero(2, 0)).toBe(true);
    expect(crossesZero(0, 0.5)).toBe(false);
    expect(crossesZero(3, 4)).toBe(false);
  });

  it('угол над линейкой — с десятыми, ноль — без них', () => {
    expect(formatAngle(-7.64)).toBe('-7.6°');
    expect(formatAngle(12)).toBe('12.0°');
    expect(formatAngle(0.02)).toBe('0°');
  });
});
