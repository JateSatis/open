import {
  alignCrop,
  applyAffine,
  coverCrop,
  cropBounds,
  cropOutputSize,
  cropTransform,
  defaultCrop,
  isCovered,
  isEmptyCrop,
  isPlainSquareCrop,
  lerpCrop,
  mirrorCrop,
  resizeCrop,
  rotateQuarter,
  screenToSourceDelta,
  squareCrop,
  totalAngle,
  withAngle,
  type Affine,
  type Box,
  type PhotoCrop,
} from './crop';

const PORTRAIT = 4 / 3;
const LANDSCAPE = 3 / 4;

function frameFor(crop: PhotoCrop): Box {
  return { x: 10, y: 20, width: 300, height: (300 * crop.height) / crop.width };
}

/** Углы рамки в исходнике (в долях ширины) через обратное преобразование. */
function frameCornersInSource(crop: PhotoCrop) {
  const frame = frameFor(crop);
  const m = cropTransform(crop, frame, 1);
  const det = m.a * m.d - m.b * m.c;
  const inverse = (x: number, y: number) => {
    const px = x - m.tx;
    const py = y - m.ty;

    return { x: (m.d * px - m.c * py) / det, y: (-m.b * px + m.a * py) / det };
  };

  return [
    inverse(frame.x, frame.y),
    inverse(frame.x + frame.width, frame.y),
    inverse(frame.x, frame.y + frame.height),
    inverse(frame.x + frame.width, frame.y + frame.height),
  ];
}

function expectNoEmptyEdges(crop: PhotoCrop) {
  expect(isCovered(crop)).toBe(true);

  for (const corner of frameCornersInSource(crop)) {
    expect(corner.x).toBeGreaterThanOrEqual(-1e-6);
    expect(corner.x).toBeLessThanOrEqual(1 + 1e-6);
    expect(corner.y).toBeGreaterThanOrEqual(-1e-6);
    expect(corner.y).toBeLessThanOrEqual(crop.sourceRatio + 1e-6);
  }
}

function close(a: { x: number; y: number }, b: { x: number; y: number }) {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
}

describe('обрезка: исходное состояние', () => {
  it('нетронутая обрезка пустая, любая правка — нет', () => {
    const crop = defaultCrop(PORTRAIT);

    expect(isEmptyCrop(crop)).toBe(true);
    expect(isEmptyCrop({ ...crop, width: 0.5 })).toBe(false);
    expect(isEmptyCrop(rotateQuarter(crop))).toBe(false);
    expect(isEmptyCrop(mirrorCrop(crop))).toBe(false);
    expect(isEmptyCrop(withAngle(crop, 3))).toBe(false);
    expect(isEmptyCrop(rotateQuarter(rotateQuarter(rotateQuarter(rotateQuarter(crop)))))).toBe(
      true,
    );
    expect(isEmptyCrop(mirrorCrop(mirrorCrop(crop)))).toBe(true);
  });

  it('без правок фото ложится в рамку ровно, пиксель в пиксель', () => {
    const crop = defaultCrop(LANDSCAPE);
    const m = cropTransform(crop, { x: 0, y: 0, width: 400, height: 300 }, 1600);

    close(applyAffine(m, 0, 0), { x: 0, y: 0 });
    close(applyAffine(m, 1600, 1200), { x: 400, y: 300 });
  });
});

describe('обрезка: одно преобразование на любое разрешение', () => {
  it('одна и та же точка исходника попадает в одно место и из копии, и из оригинала', () => {
    const crop = withAngle({ ...defaultCrop(LANDSCAPE), width: 0.5, height: 0.3, centerX: 0.4 }, 7);
    const frame = { x: 0, y: 0, width: 800, height: 480 };
    const fromCopy = cropTransform(crop, frame, 1600);
    const fromOriginal = cropTransform(crop, frame, 4000);

    close(applyAffine(fromCopy, 400, 300), applyAffine(fromOriginal, 1000, 750));
  });

  it('центр рамки — центр итоговой картинки', () => {
    const crop = mirrorCrop(
      withAngle(rotateQuarter({ ...defaultCrop(PORTRAIT), width: 0.6, height: 0.4 }), -12),
    );
    const frame = frameFor(crop);
    const m = cropTransform(crop, frame, 1000);

    close(applyAffine(m, crop.centerX * 1000, crop.centerY * 1000), {
      x: frame.x + frame.width / 2,
      y: frame.y + frame.height / 2,
    });
  });

  it('сдвиг на экране и обратно возвращает ту же точку', () => {
    const crop = mirrorCrop(withAngle(rotateQuarter(defaultCrop(PORTRAIT)), 20));
    const frame = frameFor(crop);
    const scale = frame.width / crop.width;
    const m = cropTransform(crop, frame, 1);
    const delta = screenToSourceDelta(crop, 30, -40, scale);
    const from = applyAffine(m, crop.centerX, crop.centerY);
    const to = applyAffine(m, crop.centerX + delta.x, crop.centerY + delta.y);

    close({ x: to.x - from.x, y: to.y - from.y }, { x: 30, y: -40 });
  });
});

describe('обрезка: в рамке нет пустых краёв', () => {
  const angles = [-45, -30, -7.6, 0, 3, 17.5, 45];

  it.each([PORTRAIT, LANDSCAPE, 1])('при любом угле, четверти и отражении (%p)', (ratio) => {
    for (const quarter of [0, 1, 2, 3]) {
      for (const mirrored of [false, true]) {
        for (const angle of angles) {
          let crop = { ...defaultCrop(ratio), mirrored };

          for (let turn = 0; turn < quarter; turn += 1) crop = rotateQuarter(crop);

          expectNoEmptyEdges(withAngle(crop, angle));
          expectNoEmptyEdges(
            withAngle(
              { ...crop, width: crop.width / 3, height: crop.height / 2, centerX: 0.05 },
              angle,
            ),
          );
        }
      }
    }
  });

  it('поворот увеличивает фото ровно настолько, насколько нужно, и возвращает назад', () => {
    const base = defaultCrop(LANDSCAPE);
    const turned = withAngle(base, 10);

    expect(turned.width).toBeLessThan(base.width);
    expect(turned.width / turned.height).toBeCloseTo(base.width / base.height, 9);
    expect(withAngle(base, 0)).toEqual(base);
    expect(withAngle(base, 60).angle).toBe(45);
    expect(withAngle(base, -60).angle).toBe(-45);
  });

  it('вытащенный за край центр подтягивается обратно', () => {
    const crop = coverCrop({
      ...defaultCrop(PORTRAIT),
      width: 0.5,
      height: 0.5,
      centerX: -0.3,
      centerY: 9,
    });

    expectNoEmptyEdges(crop);
    expect(crop.width).toBeCloseTo(0.5, 9);
  });

  it('переход между двумя обрезками не открывает краёв ни на одном шаге', () => {
    const from = withAngle(
      { ...defaultCrop(PORTRAIT), width: 0.4, height: 0.3, centerX: 0.25, centerY: 1.1 },
      -30,
    );
    const to = defaultCrop(PORTRAIT);

    for (let step = 0; step <= 20; step += 1) expectNoEmptyEdges(lerpCrop(from, to, step / 20));
  });
});

describe('обрезка аватарки: квадрат', () => {
  it('начальная рамка — наибольший квадрат по центру, и у портрета, и у пейзажа', () => {
    const portrait = squareCrop(PORTRAIT);
    const landscape = squareCrop(LANDSCAPE);

    expect([portrait.width, portrait.height]).toEqual([1, 1]);
    expect([portrait.centerX, portrait.centerY]).toEqual([0.5, PORTRAIT / 2]);
    expect([landscape.width, landscape.height]).toEqual([LANDSCAPE, LANDSCAPE]);
    expect(isCovered(portrait)).toBe(true);
    expect(isCovered(landscape)).toBe(true);
  });

  it('нетронутый квадрат — не правка, сдвинутый — правка', () => {
    const plain = squareCrop(PORTRAIT);

    expect(isPlainSquareCrop(plain)).toBe(true);
    expect(isPlainSquareCrop({ ...plain, centerY: plain.centerY - 0.1 })).toBe(false);
    expect(isPlainSquareCrop(rotateQuarter(plain))).toBe(false);
  });

  it('поворот на 90° и подгонка под фото квадрат не ломают', () => {
    const turned = coverCrop(rotateQuarter(squareCrop(PORTRAIT)));

    expect(turned.width).toBeCloseTo(turned.height, 9);
  });
});

describe('обрезка: поворот на 90° и отражение', () => {
  it('поворот против часовой меняет стороны рамки, четыре — исходная ориентация', () => {
    const crop = { ...defaultCrop(PORTRAIT), width: 0.8, height: 0.5 };
    const once = rotateQuarter(crop);

    expect(totalAngle(once)).toBe(-90);
    expect([once.width, once.height]).toEqual([0.5, 0.8]);
    expect(rotateQuarter(rotateQuarter(rotateQuarter(once)))).toEqual(crop);
  });

  it('точка правее центра после поворота против часовой оказывается выше', () => {
    const crop = rotateQuarter(defaultCrop(1));
    const m = cropTransform(crop, frameFor(crop), 1);
    const center = applyAffine(m, 0.5, 0.5);
    const right = applyAffine(m, 0.7, 0.5);

    expect(right.x).toBeCloseTo(center.x, 6);
    expect(right.y).toBeLessThan(center.y);
  });

  it('отражение зеркалит то, что видно в рамке, вокруг её центра', () => {
    const crop = withAngle(
      rotateQuarter({ ...defaultCrop(LANDSCAPE), width: 0.5, height: 0.4 }),
      12,
    );
    const mirrored = mirrorCrop(crop);
    const frame = frameFor(crop);
    const before = cropTransform(crop, frame, 1);
    const after = cropTransform(mirrored, frame, 1);
    const axis = frame.x + frame.width / 2;
    const point = { x: 0.45, y: 0.3 };
    const seenBefore = applyAffine(before, point.x, point.y);
    const seenAfter = applyAffine(after, point.x, point.y);

    close(seenAfter, { x: 2 * axis - seenBefore.x, y: seenBefore.y });
    expect(mirrored.angle).toBe(-12);
  });

  it('после отражения угол вправо крутит вправо', () => {
    const crop = mirrorCrop(defaultCrop(1));
    const frame = frameFor(crop);
    const top = (c: PhotoCrop) => applyAffine(cropTransform(c, frame, 1), 0.5, 0.3);
    const straight = top(crop);
    const turned = top(withAngle(crop, 10));

    // Точка над центром при повороте по часовой уходит вправо.
    expect(turned.x).toBeGreaterThan(straight.x);
  });
});

describe('обрезка: переход с разворотом', () => {
  /** Как выглядит точка исходника после жёсткого разворота и отражения вокруг центра рамки. */
  function aligned(
    m: Affine,
    frame: Box,
    rotation: number,
    mirror: number,
    target: Box,
    scale: number,
    x: number,
    y: number,
  ) {
    const p = applyAffine(m, x, y);
    const cx = frame.x + frame.width / 2;
    const cy = frame.y + frame.height / 2;
    const r = (rotation * Math.PI) / 180;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const rx = Math.cos(r) * dx - Math.sin(r) * dy;
    const ry = Math.sin(r) * dx + Math.cos(r) * dy;

    return {
      x: target.x + target.width / 2 + rx * scale * mirror,
      y: target.y + target.height / 2 + ry * scale,
    };
  }

  it.each([
    ['поворот на 90°', (c: PhotoCrop) => rotateQuarter(c)],
    ['отражение', (c: PhotoCrop) => mirrorCrop(c)],
    ['сброс', (c: PhotoCrop) => defaultCrop(c.sourceRatio)],
  ])('%s: старт перехода совпадает с прежней картинкой', (_, change) => {
    const before = mirrorCrop(
      withAngle(rotateQuarter({ ...defaultCrop(PORTRAIT), width: 0.7, height: 0.5 }), 8),
    );
    const after = change(before);
    const start = alignCrop(before, after);
    const frameBefore = frameFor(before);
    const frameAligned = frameFor(start.from);
    const odd = Math.abs(start.rotation) % 180 === 90;
    const scale = frameBefore.width / (odd ? frameAligned.height : frameAligned.width);
    const m = cropTransform(start.from, frameAligned, 1);

    for (const [x, y] of [
      [0.5, 0.6],
      [0.3, 0.9],
      [0.7, 0.4],
    ] as const) {
      close(
        aligned(m, frameAligned, start.rotation, start.mirror, frameBefore, scale, x, y),
        applyAffine(cropTransform(before, frameBefore, 1), x, y),
      );
    }
  });
});

describe('обрезка: запекание', () => {
  it('по ширине — как обычное фото отправки, если исходник позволяет', () => {
    const crop = { ...defaultCrop(LANDSCAPE), width: 0.5, height: 0.25 };

    expect(cropOutputSize(crop, 4000, 1600)).toEqual({ width: 1600, height: 800 });
    expect(cropOutputSize(crop, 2000, 1600)).toEqual({ width: 1000, height: 500 });
  });

  it('поворот на 90° меняет ширину и высоту местами', () => {
    const crop = defaultCrop(LANDSCAPE);

    expect(cropOutputSize(rotateQuarter(crop), 1200, 1600)).toEqual({ width: 900, height: 1200 });
  });

  it('область исходника под рамкой целиком внутри исходника', () => {
    const crop = withAngle(
      { ...defaultCrop(PORTRAIT), width: 0.5, height: 0.5, centerX: 0.3, centerY: 1 },
      30,
    );
    const bounds = cropBounds(crop);

    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(PORTRAIT + 1e-9);
  });
});

describe('обрезка: ручки рамки', () => {
  it('рамка тянется при неподвижном фото', () => {
    const crop = defaultCrop(LANDSCAPE);
    const frame = { x: 0, y: 0, width: 400, height: 300 };
    const scale = 400;
    const next = resizeCrop(crop, frame, { x: 0, y: 100, width: 400, height: 200 }, scale);
    const before = cropTransform(crop, frame, 1);
    const after = cropTransform(next, { x: 0, y: 100, width: 400, height: 200 }, 1);

    expect(next.width).toBeCloseTo(1, 9);
    expect(next.height).toBeCloseTo(0.5, 9);
    close(applyAffine(after, 0.3, 0.6), applyAffine(before, 0.3, 0.6));
  });
});
