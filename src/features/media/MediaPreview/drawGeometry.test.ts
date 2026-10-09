import { drawGeometry, MAX_DRAW_ZOOM, pinchZoom, screenToUnits } from './drawGeometry';

import { defaultCrop, rotateQuarter } from '@/features/media/photoEdits/crop';

const SCREEN = { x: 0, y: 0, width: 400, height: 800 };
// Рабочая область вдвое уже экрана: фото ужато в два раза.
const AREA = { x: 100, y: 200, width: 200, height: 400 };
const NO_ZOOM = { scale: 1, x: 0, y: 0 };

describe('экран → единицы рисунка', () => {
  it('углы ужатого фото — углы исходника', () => {
    const crop = defaultCrop(1);
    const g = drawGeometry(crop, SCREEN, AREA, NO_ZOOM);

    // Квадрат 200×200 по центру области.
    expect(g.frame).toEqual({ x: 100, y: 300, width: 200, height: 200 });
    expect(screenToUnits(g, 100, 300)).toEqual({ x: 0, y: 0 });

    const corner = screenToUnits(g, 300, 500);

    expect(corner.x).toBeCloseTo(1);
    expect(corner.y).toBeCloseTo(1);
  });

  it('толщина в точках экрана переводится по ужатию и увеличению', () => {
    const crop = defaultCrop(1);

    expect(drawGeometry(crop, SCREEN, AREA, NO_ZOOM).pointsPerUnit).toBe(200);
    expect(drawGeometry(crop, SCREEN, AREA, { scale: 2, x: 0, y: 0 }).pointsPerUnit).toBe(400);
  });

  it('поворот обрезки на 90° учитывается: левый верх экрана — левый низ исходника', () => {
    const crop = rotateQuarter(defaultCrop(1));
    const point = screenToUnits(drawGeometry(crop, SCREEN, AREA, NO_ZOOM), 100, 300);

    expect(point.x).toBeCloseTo(1);
    expect(point.y).toBeCloseTo(0);
  });

  it('при увеличении штрих ложится точно под палец', () => {
    const crop = defaultCrop(1);
    // Увеличено вдвое к левому верхнему углу холста.
    const g = drawGeometry(crop, SCREEN, AREA, { scale: 2, x: 0, y: 0 });
    const point = screenToUnits(g, 200, 400);

    // Середина ужатого фото — это четверть исходника при двойном увеличении.
    expect(point.x).toBeCloseTo(0.25);
    expect(point.y).toBeCloseTo(0.25);
  });
});

describe('щипок в рисовании', () => {
  const crop = defaultCrop(1);
  const g = drawGeometry(crop, SCREEN, AREA, NO_ZOOM);
  const start = { scale: 1, x: 0, y: 0, ax: 180, ay: 400, bx: 220, by: 400 };

  it('развести пальцы вдвое — вдвое крупнее, точка между пальцами на месте', () => {
    const zoom = pinchZoom(g, start, { x: 160, y: 400 }, { x: 240, y: 400 });

    expect(zoom.scale).toBeCloseTo(2);

    const after = screenToUnits({ ...g, zoom, pointsPerUnit: 0 }, 200, 400);

    expect(after.x).toBeCloseTo(0.5);
    expect(after.y).toBeCloseTo(0.5);
  });

  it('мельче исходного и крупнее предела — нельзя, за края не уводится', () => {
    expect(pinchZoom(g, start, { x: 195, y: 400 }, { x: 205, y: 400 })).toEqual(NO_ZOOM);
    expect(pinchZoom(g, start, { x: 0, y: 400 }, { x: 4000, y: 400 }).scale).toBe(MAX_DRAW_ZOOM);

    // Сдвинуть пальцами вправо при двойном увеличении: левый край не отходит.
    const moved = pinchZoom(
      g,
      { ...start, scale: 2, x: -400, y: -400 },
      { x: 380, y: 400 },
      { x: 420, y: 400 },
    );

    expect(moved.x).toBeLessThanOrEqual(0);
  });
});
