import { drawGeometry } from './drawGeometry';
import { loupeCenter, loupeMatrix, screenToPixel } from './eyedropperPixels';

import {
  applyAffine,
  coverCrop,
  defaultCrop,
  rotateQuarter,
  type PhotoCrop,
} from '@/features/media/photoEdits/crop';

jest.mock('@shopify/react-native-skia', () => ({ AlphaType: {}, ColorType: {}, Skia: {} }));

const SCREEN = { x: 0, y: 0, width: 400, height: 800 };
const AREA = { x: 20, y: 100, width: 360, height: 560 };
/** Ширина рабочей копии, пиксели. */
const WIDTH = 1600;

/** Пиксель копии → точка экрана: как фото рисуется — обрезка, увеличение, ужатие. */
function pixelToScreen(
  crop: PhotoCrop,
  zoom: { scale: number; x: number; y: number },
  px: number,
  py: number,
) {
  const g = drawGeometry(crop, SCREEN, AREA, zoom, 1);
  const canvas = applyAffine(g.unitsToCanvas, px / WIDTH, py / WIDTH);
  const k = g.frame.width / g.base.width;

  return {
    x: g.frame.x + (canvas.x * zoom.scale + zoom.x) * k,
    y: g.frame.y + (canvas.y * zoom.scale + zoom.y) * k,
  };
}

describe('пипетка: точка под лупой → пиксель фото', () => {
  const tilted: PhotoCrop = coverCrop({
    ...rotateQuarter(defaultCrop(0.75)),
    angle: 17,
    mirrored: true,
  });
  const zoom = { scale: 2.5, x: -300, y: -200 };

  it('с увеличением и обрезкой с поворотом берётся ровно тот пиксель, что под лупой', () => {
    const g = drawGeometry(tilted, SCREEN, AREA, zoom, 1);

    for (const [px, py] of [
      [800, 600],
      [700.5, 520.25],
      [900, 640],
    ]) {
      const screen = pixelToScreen(tilted, zoom, px, py);
      const back = screenToPixel(g, WIDTH, screen.x, screen.y);

      expect(back.x).toBeCloseTo(px, 6);
      expect(back.y).toBeCloseTo(py, 6);
    }
  });

  it('в лупе пиксель под центром — ровно в центре, соседний — на клетку в ту же сторону, что на экране', () => {
    const center = { x: 150, y: 300 };
    const cell = 12;
    const m = loupeMatrix(tilted, center, { x: 800.7, y: 600.2 }, cell);
    const at = (x: number, y: number) => ({
      x: m[0] * x + m[1] * y + m[2],
      y: m[3] * x + m[4] * y + m[5],
    });

    const middle = at(800.5, 600.5);

    expect(middle.x).toBeCloseTo(center.x);
    expect(middle.y).toBeCloseTo(center.y);

    // Направление шага на пиксель вправо — как у фото на экране, длина — клетка.
    const step = at(801.5, 600.5);
    const onScreen = {
      from: pixelToScreen(tilted, { scale: 1, x: 0, y: 0 }, 800, 600),
      to: pixelToScreen(tilted, { scale: 1, x: 0, y: 0 }, 801, 600),
    };
    const screenAngle = Math.atan2(
      onScreen.to.y - onScreen.from.y,
      onScreen.to.x - onScreen.from.x,
    );

    expect(Math.hypot(step.x - center.x, step.y - center.y)).toBeCloseTo(cell);
    expect(Math.atan2(step.y - center.y, step.x - center.x)).toBeCloseTo(screenAngle);
  });
});

describe('пипетка: где лупа', () => {
  const frame = { x: 20, y: 100, width: 360, height: 480 };

  it('под пальцем, пока целиком внутри фото', () => {
    expect(loupeCenter(frame, 60, 200, 300)).toEqual({ x: 200, y: 300 });
  });

  it('у края фото не выходит за него — и не залезает выше фото, под вырез', () => {
    expect(loupeCenter(frame, 60, 25, 90)).toEqual({ x: 80, y: 160 });
    expect(loupeCenter(frame, 60, 400, 700)).toEqual({ x: 320, y: 520 });
  });

  it('фото уже лупы — лупа по его середине', () => {
    expect(loupeCenter({ x: 0, y: 0, width: 100, height: 400 }, 60, 90, 200)).toEqual({
      x: 50,
      y: 200,
    });
  });
});
