/**
 * Обрезка и поворот фото — геометрия, одна на показ, запекание и перелёт.
 *
 * Все длины — в долях ширины исходника (повёрнутого по EXIF): единица одна по
 * обеим осям, поэтому поворот не искажает расстояния, а одна и та же обрезка
 * одинаково ложится и на рабочую копию в 1600, и на исходник в 4000. Высота
 * исходника в этих единицах — `sourceRatio` (H / W).
 *
 * Рамка — прямоугольник итоговой картинки. Её центр хранится точкой
 * исходника, а не экрана: поворот на 90° и отражение вертят фото вокруг
 * центра рамки, и эта точка от них не меняется. Рисунок этапа 3 ляжет в
 * координатах итоговой картинки поверх `cropTransform`, и правка обрезки
 * будет двигать его вместе с фото.
 *
 * Порядок преобразований, исходник → итог: отражение по горизонтали, затем
 * поворот по часовой на `totalAngle` вокруг центра рамки. Отражение первым —
 * поэтому угол всегда экранный: «вправо» на линейке крутит вправо и после
 * отражения.
 */
export type PhotoCrop = {
  /** H / W исходника, повёрнутого по EXIF. */
  sourceRatio: number;
  /** Центр рамки — точка исходника, в долях его ширины. */
  centerX: number;
  centerY: number;
  /** Стороны рамки (итоговой картинки), в долях ширины исходника. */
  width: number;
  height: number;
  /** Точный поворот по часовой, градусы, от −45 до 45. */
  angle: number;
  /** Повороты на 90° против часовой, 0–3. */
  quarter: number;
  /** Отражение по горизонтали. */
  mirrored: boolean;
};

/** Плоское преобразование: x' = a·x + c·y + tx, y' = b·x + d·y + ty. */
export type Affine = { a: number; b: number; c: number; d: number; tx: number; ty: number };

export type Box = { x: number; y: number; width: number; height: number };

export const MAX_FINE_ANGLE = 45;
/** Сильнее не увеличить: рамка — не меньше этой доли короткой стороны исходника. */
const MIN_CROP_SHARE = 0.1;
const EPSILON = 1e-4;

export function defaultCrop(sourceRatio: number): PhotoCrop {
  'worklet';
  return {
    sourceRatio,
    centerX: 0.5,
    centerY: sourceRatio / 2,
    width: 1,
    height: sourceRatio,
    angle: 0,
    quarter: 0,
    mirrored: false,
  };
}

function near(a: number, b: number): boolean {
  'worklet';
  return Math.abs(a - b) < EPSILON;
}

/** Нетронутая обрезка — то же, что её отсутствие. */
export function isEmptyCrop(crop: PhotoCrop): boolean {
  'worklet';
  const plain = defaultCrop(crop.sourceRatio);

  return (
    !crop.mirrored &&
    crop.quarter === 0 &&
    near(crop.angle, 0) &&
    near(crop.centerX, plain.centerX) &&
    near(crop.centerY, plain.centerY) &&
    near(crop.width, plain.width) &&
    near(crop.height, plain.height)
  );
}

/** Полный угол поворота по часовой, градусы. */
export function totalAngle(crop: PhotoCrop): number {
  'worklet';
  return crop.angle - 90 * crop.quarter;
}

/** Пропорции итоговой картинки. */
export function cropAspect(crop: PhotoCrop): number {
  'worklet';
  return crop.width / crop.height;
}

function radians(degrees: number): number {
  'worklet';
  return (degrees * Math.PI) / 180;
}

/**
 * Полуразмеры рамки, повёрнутой обратно в исходник: насколько её углы
 * отходят от центра по осям исходника. Отражение на них не влияет.
 */
export function cropExtents(crop: PhotoCrop): { x: number; y: number } {
  'worklet';
  const angle = radians(totalAngle(crop));
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));

  return {
    x: (crop.width * cos + crop.height * sin) / 2,
    y: (crop.width * sin + crop.height * cos) / 2,
  };
}

/** В рамке нет пустых краёв: все её углы внутри исходника. */
export function isCovered(crop: PhotoCrop, tolerance?: number): boolean {
  'worklet';
  // Не значением по умолчанию: его ворклет не захватывает.
  const slack = tolerance ?? EPSILON;
  const extents = cropExtents(crop);

  return (
    crop.centerX - extents.x >= -slack &&
    crop.centerX + extents.x <= 1 + slack &&
    crop.centerY - extents.y >= -slack &&
    crop.centerY + extents.y <= crop.sourceRatio + slack
  );
}

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

/** Центр, сдвинутый ровно настолько, чтобы рамка не выходила за исходник. */
export function clampCenter(crop: PhotoCrop): PhotoCrop {
  'worklet';
  const extents = cropExtents(crop);

  return {
    ...crop,
    centerX: clamp(crop.centerX, extents.x, Math.max(extents.x, 1 - extents.x)),
    centerY: clamp(crop.centerY, extents.y, Math.max(extents.y, crop.sourceRatio - extents.y)),
  };
}

/**
 * Во сколько раз рамка больше той, что ровно помещается в исходник при
 * своём угле: меньше 1 — есть запас. Линейна по размеру рамки.
 */
export function fitZoom(crop: PhotoCrop): number {
  'worklet';
  const extents = cropExtents(crop);

  return Math.max(2 * extents.x, (2 * extents.y) / crop.sourceRatio);
}

/**
 * Во сколько раз уменьшить рамку (увеличить фото), чтобы она поместилась в
 * исходник при своём угле. 1 — уже помещается.
 */
export function coverZoom(crop: PhotoCrop): number {
  'worklet';
  return Math.max(1, fitZoom(crop));
}

/** Короткая сторона самой маленькой рамки: сильнее фото не увеличить. */
export function minCropSide(crop: PhotoCrop): number {
  'worklet';
  return Math.min(1, crop.sourceRatio) * MIN_CROP_SHARE;
}

/** Самая узкая рамка этих пропорций. */
export function minCropWidth(crop: PhotoCrop): number {
  'worklet';
  return minCropSide(crop) * Math.max(1, crop.width / crop.height);
}

/**
 * Обрезка без пустых краёв: фото увеличивается ровно настолько, насколько
 * нужно при этом угле, и центр подтягивается внутрь. Пропорции рамки не
 * меняются.
 */
export function coverCrop(crop: PhotoCrop): PhotoCrop {
  'worklet';
  const zoom = coverZoom(crop);

  return clampCenter({ ...crop, width: crop.width / zoom, height: crop.height / zoom });
}

/**
 * Где лежит рамка на экране и как туда попадает фото: точка исходника в
 * пикселях `sourcePx` (ширина картинки, с которой рисуем) → точка внутри
 * прямоугольника `frame`. Одна функция для показа, запекания и перелёта.
 */
export function cropTransform(crop: PhotoCrop, frame: Box, sourcePx: number): Affine {
  'worklet';
  const scale = frame.width / crop.width;
  const angle = radians(totalAngle(crop));
  const cos = Math.cos(angle) * scale;
  const sin = Math.sin(angle) * scale;
  const mirror = crop.mirrored ? -1 : 1;
  const unit = 1 / sourcePx;

  // screen = center + R(θ)·S·M·(p/px − c)
  const a = cos * mirror * unit;
  const b = sin * mirror * unit;
  const c = -sin * unit;
  const d = cos * unit;
  const frameX = frame.x + frame.width / 2;
  const frameY = frame.y + frame.height / 2;
  const centerX = crop.centerX * sourcePx;
  const centerY = crop.centerY * sourcePx;

  return {
    a,
    b,
    c,
    d,
    tx: frameX - (a * centerX + c * centerY),
    ty: frameY - (b * centerX + d * centerY),
  };
}

export function applyAffine(m: Affine, x: number, y: number): { x: number; y: number } {
  'worklet';
  return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
}

/** Матрица 3×3 по строкам — так её принимает Skia. */
export function affineToMatrix(m: Affine): number[] {
  'worklet';
  return [m.a, m.c, m.tx, m.b, m.d, m.ty, 0, 0, 1];
}

/**
 * Сдвиг на экране → сдвиг в исходнике, при масштабе `scale` точек экрана на
 * единицу исходника. Обратное к повороту и отражению `cropTransform`.
 */
export function screenToSourceDelta(
  crop: PhotoCrop,
  dx: number,
  dy: number,
  scale: number,
): { x: number; y: number } {
  'worklet';
  const angle = radians(totalAngle(crop));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const mirror = crop.mirrored ? -1 : 1;
  // R(−θ)·Δ, затем отражение.
  const x = (cos * dx + sin * dy) / scale;
  const y = (-sin * dx + cos * dy) / scale;

  return { x: x * mirror, y };
}

/** Размер итоговой картинки: по ширине — как обычное фото отправки, если исходник позволяет. */
export function cropOutputSize(
  crop: PhotoCrop,
  sourceWidthPx: number,
  maxWidthPx: number,
): { width: number; height: number } {
  const width = Math.max(1, Math.round(Math.min(maxWidthPx, crop.width * sourceWidthPx)));

  return { width, height: Math.max(1, Math.round((width * crop.height) / crop.width)) };
}

/** Прямоугольник исходника, в который попадает рамка, — в долях его ширины. */
export function cropBounds(crop: PhotoCrop): Box {
  'worklet';
  const extents = cropExtents(crop);

  return {
    x: crop.centerX - extents.x,
    y: crop.centerY - extents.y,
    width: extents.x * 2,
    height: extents.y * 2,
  };
}

/** Поворот на 90° против часовой: фото с рамкой разворачиваются вокруг её центра. */
export function rotateQuarter(crop: PhotoCrop): PhotoCrop {
  'worklet';
  return {
    ...crop,
    quarter: (crop.quarter + 1) % 4,
    width: crop.height,
    height: crop.width,
  };
}

/**
 * Отражение по горизонтали того, что видно в рамке. Угол экранный, поэтому
 * отражённый наклон — это наклон в другую сторону: угол и четверти меняют
 * знак.
 */
export function mirrorCrop(crop: PhotoCrop): PhotoCrop {
  'worklet';
  return {
    ...crop,
    mirrored: !crop.mirrored,
    angle: crop.angle === 0 ? 0 : -crop.angle,
    quarter: (4 - crop.quarter) % 4,
  };
}

/**
 * Новый точный угол от обрезки на начало поворота: рамка на месте, фото
 * увеличивается ровно настолько, чтобы закрыть её. Считается от начала
 * жеста, а не от прошлого кадра: вернул угол — вернулось и увеличение.
 */
export function withAngle(base: PhotoCrop, angle: number): PhotoCrop {
  'worklet';
  return coverCrop({ ...base, angle: clamp(angle, -MAX_FINE_ANGLE, MAX_FINE_ANGLE) });
}

/**
 * Обрезка посередине пути: для плавных переходов. С `cover` пустых краёв
 * нет на любом шаге; без него — фото, вытащенное за край, пружинит обратно.
 */
export function lerpCrop(
  from: PhotoCrop,
  to: PhotoCrop,
  progress: number,
  cover = true,
): PhotoCrop {
  'worklet';
  const mix = (a: number, b: number) => a + (b - a) * progress;
  const mixScale = (a: number, b: number) => a * Math.pow(b / a, progress);
  const mixed = {
    ...to,
    centerX: mix(from.centerX, to.centerX),
    centerY: mix(from.centerY, to.centerY),
    width: mixScale(from.width, to.width),
    height: mixScale(from.height, to.height),
    angle: mix(from.angle, to.angle),
  };

  return cover ? coverCrop(mixed) : mixed;
}

/**
 * Переход от одной обрезки к другой, когда у них разные четверть или
 * отражение. `from` переписывается в четверть и отражение `to` — это та же
 * картинка, только развёрнутая на `rotation` градусов и отражённая
 * `mirror`, — и дальше плавно меняются только угол, центр и размер, а
 * разворот с отражением гаснут поверх, жёстко, вместе с рамкой.
 */
export function alignCrop(
  from: PhotoCrop,
  to: PhotoCrop,
): { from: PhotoCrop; rotation: number; mirror: number } {
  'worklet';
  let aligned = from;
  let mirror = 1;

  if (from.mirrored !== to.mirrored) {
    aligned = {
      ...from,
      mirrored: to.mirrored,
      angle: -from.angle,
      quarter: (4 - from.quarter) % 4,
    };
    mirror = -1;
  }

  let turns = (((to.quarter - aligned.quarter) % 4) + 4) % 4;

  if (turns === 3) turns = -1;

  // Сменилась ориентация рамки — её стороны меняются местами.
  const odd = turns % 2 !== 0;

  aligned = {
    ...aligned,
    quarter: to.quarter,
    width: odd ? aligned.height : aligned.width,
    height: odd ? aligned.width : aligned.height,
  };

  return { from: aligned, rotation: turns * 90, mirror };
}

/**
 * Рамка, растянутая жестом за ручку, при неподвижном фото: экранный
 * прямоугольник `next` вместо `start` → новая обрезка. `scale` — точек
 * экрана на единицу исходника, он не меняется, пока тянут.
 */
export function resizeCrop(start: PhotoCrop, startFrame: Box, next: Box, scale: number): PhotoCrop {
  'worklet';
  const shift = screenToSourceDelta(
    start,
    next.x + next.width / 2 - (startFrame.x + startFrame.width / 2),
    next.y + next.height / 2 - (startFrame.y + startFrame.height / 2),
    scale,
  );

  return {
    ...start,
    centerX: start.centerX + shift.x,
    centerY: start.centerY + shift.y,
    width: next.width / scale,
    height: next.height / scale,
  };
}
