import { fitRect, flightTransform } from './previewGeometry';

const SCREEN = { x: 0, y: 0, width: 400, height: 800 };

describe('fitRect по краям', () => {
  it('вертикальное уже экрана — по высоте, по центру по ширине', () => {
    expect(fitRect(1 / 4, SCREEN)).toEqual({ x: 100, y: 0, width: 200, height: 800 });
  });

  it('вертикальное шире экрана (3:4) — по ширине, целиком', () => {
    const rect = fitRect(3 / 4, SCREEN);

    expect(rect.width).toBe(400);
    expect(rect.height).toBeCloseTo(533.33, 1);
  });

  it('горизонтальное — по ширине, по центру по высоте', () => {
    expect(fitRect(2, SCREEN)).toEqual({ x: 0, y: 300, width: 400, height: 200 });
  });

  it('без размеров — квадрат', () => {
    expect(fitRect(0, SCREEN)).toEqual({ x: 0, y: 200, width: 400, height: 400 });
  });
});

describe('flightTransform', () => {
  const base = fitRect(2, SCREEN);
  const tile = { x: 10, y: 600, width: 100, height: 100 };

  it('на месте — без трансформов', () => {
    expect(flightTransform(base, base, tile, 1)).toEqual({
      frame: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 },
      image: { scaleX: 1, scaleY: 1 },
    });
  });

  it('в плитке — рамка в квадрат плитки, фото покрывает её без искажения', () => {
    const { frame, image } = flightTransform(base, base, tile, 0);

    expect(base.width * frame.scaleX).toBeCloseTo(100);
    expect(base.height * frame.scaleY).toBeCloseTo(100);
    expect(base.x + base.width / 2 + frame.translateX).toBeCloseTo(60);
    expect(base.y + base.height / 2 + frame.translateY).toBeCloseTo(650);

    const shownWidth = base.width * frame.scaleX * image.scaleX;
    const shownHeight = base.height * frame.scaleY * image.scaleY;

    expect(shownWidth / shownHeight).toBeCloseTo(2);
    expect(shownHeight).toBeCloseTo(100);
  });
});
