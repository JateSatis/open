import type { SharedValue } from 'react-native-reanimated';

import { fitRect } from './previewGeometry';

import {
  cropAspect,
  cropTransform,
  lerpCrop,
  type Affine,
  type Box,
  type PhotoCrop,
} from '@/features/media/photoEdits/crop';

/**
 * Жёсткий разворот поверх перехода: с чего он начинается и к нулю гаснет.
 * Поворот и отражение — вокруг центра рамки; масштаб и сдвиг переводят
 * рамку из её нового места в прежнее, так что первый кадр перехода совпадает
 * с последним кадром до него.
 */
export type CropTwist = {
  rotation: number;
  mirror: number;
  scale: number;
  shiftX: number;
  shiftY: number;
};

export const NO_TWIST: CropTwist = { rotation: 0, mirror: 1, scale: 1, shiftX: 0, shiftY: 0 };

/** Всё, что рисует обрезку, — на UI-потоке, без React на каждом кадре. */
export type CropMotion = {
  /** Обрезка сейчас, а во время перехода — куда он ведёт. */
  crop: SharedValue<PhotoCrop>;
  /** Откуда идёт переход (уже в четверти и отражении `crop`). */
  from: SharedValue<PhotoCrop>;
  twist: SharedValue<CropTwist>;
  /** Переход: 0 — `from`, 1 — пришли. */
  t: SharedValue<number>;
  /** Переход закрывает рамку на каждом шаге. Нет — фото пружинит из-за края. */
  covering: SharedValue<boolean>;
  /** Рамка, которую сейчас тянут; нет — рамка вписана в рабочее поле. */
  frame: SharedValue<Box | null>;
  /** Рабочее поле рамки на экране. */
  area: SharedValue<Box>;
  /** Весь слой: туда фото вписано на странице предпросмотра. */
  screen: SharedValue<Box>;
  /** Вход и выход инструмента: 0 — фото на странице, 1 — в рамке. */
  enter: SharedValue<number>;
  /** Сетка 3×3: видна, пока тянут рамку или крутят. */
  grid: SharedValue<number>;
};

export type CropVisual = {
  /** Обрезка этого кадра. */
  crop: PhotoCrop;
  /** Рамка до разворота и входа. */
  frame: Box;
  /** Разворот и вход — поверх всего, что нарисовано в координатах рамки. */
  group: Affine;
};

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/** a ∘ b: сначала b, потом a. */
export function compose(a: Affine, b: Affine): Affine {
  'worklet';
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    tx: a.a * b.tx + a.c * b.ty + a.tx,
    ty: a.b * b.tx + a.d * b.ty + a.ty,
  };
}

/**
 * Подобие вокруг точки (cx, cy): поворот, затем отражение и масштаб, затем
 * сдвиг.
 */
function similarity(
  cx: number,
  cy: number,
  rotation: number,
  mirror: number,
  scale: number,
  shiftX: number,
  shiftY: number,
): Affine {
  'worklet';
  const r = (rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const a = scale * mirror * cos;
  const c = -scale * mirror * sin;
  const b = scale * sin;
  const d = scale * cos;

  return {
    a,
    b,
    c,
    d,
    tx: cx + shiftX - (a * cx + c * cy),
    ty: cy + shiftY - (b * cx + d * cy),
  };
}

export function boxCenter(box: Box): { x: number; y: number } {
  'worklet';
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Рамка, вписанная в рабочее поле. */
export function fittedFrame(crop: PhotoCrop, area: Box): Box {
  'worklet';
  return fitRect(cropAspect(crop), area);
}

/** Обрезка этого кадра — с учётом идущего перехода. */
export function currentCrop(m: CropMotion): PhotoCrop {
  'worklet';
  const t = m.t.value;

  if (t >= 1) return m.crop.value;

  return lerpCrop(m.from.value, m.crop.value, t, m.covering.value);
}

/** Что нарисовать на этом кадре. */
export function cropVisual(m: CropMotion): CropVisual {
  'worklet';
  const crop = currentCrop(m);
  const frame = m.frame.value ?? fittedFrame(crop, m.area.value);
  const center = boxCenter(frame);
  const rest = Math.max(0, 1 - m.t.value);
  const twist = m.twist.value;
  let group = IDENTITY;

  if (rest > 0) {
    group = similarity(
      center.x,
      center.y,
      twist.rotation * rest,
      twist.mirror + (1 - twist.mirror) * (1 - rest),
      Math.pow(twist.scale, rest),
      twist.shiftX * rest,
      twist.shiftY * rest,
    );
  }

  const enter = m.enter.value;

  if (enter < 1) {
    // Вход и выход: рамка с итоговой обрезкой ⇄ фото на странице.
    const fitted = fittedFrame(m.crop.value, m.area.value);
    const page = fitRect(cropAspect(m.crop.value), m.screen.value);
    const from = boxCenter(fitted);
    const to = boxCenter(page);
    const away = 1 - enter;

    group = compose(
      similarity(
        from.x,
        from.y,
        0,
        1,
        Math.pow(page.width / fitted.width, away),
        (to.x - from.x) * away,
        (to.y - from.y) * away,
      ),
      group,
    );
  }

  return { crop, frame, group };
}

/** Пиксели картинки (`sourcePx` в ширину) → координаты рамки этого кадра. */
export function imagePlacement(visual: CropVisual, sourcePx: number): Affine {
  'worklet';
  return cropTransform(visual.crop, visual.frame, sourcePx);
}

/**
 * Разворот, который переводит рамку `aligned` (вписанную) в рамку `before`
 * на экране — с поворотом на `rotation` и отражением `mirror`.
 */
export function twistBetween(
  before: Box,
  aligned: Box,
  rotation: number,
  mirror: number,
): CropTwist {
  'worklet';
  const odd = Math.abs(rotation) % 180 === 90;
  const from = boxCenter(aligned);
  const to = boxCenter(before);

  return {
    rotation,
    mirror,
    scale: before.width / (odd ? aligned.height : aligned.width),
    shiftX: to.x - from.x,
    shiftY: to.y - from.y,
  };
}

/**
 * Где рамка на экране сейчас, пока догорает доцентровка — разворот без
 * поворота и отражения, только сдвиг и масштаб.
 */
export function recenteringFrame(m: CropMotion, frame: Box): Box {
  'worklet';
  const rest = Math.max(0, 1 - m.t.value);
  const twist = m.twist.value;
  const scale = Math.pow(twist.scale, rest);
  const center = boxCenter(frame);
  const width = frame.width * scale;
  const height = frame.height * scale;

  return {
    x: center.x + twist.shiftX * rest - width / 2,
    y: center.y + twist.shiftY * rest - height / 2,
    width,
    height,
  };
}

/** Идёт только доцентровка: где рамка на экране, известно точно. */
export function isRecentering(m: CropMotion): boolean {
  'worklet';
  const twist = m.twist.value;

  return m.t.value < 1 && twist.rotation === 0 && twist.mirror === 1 && m.frame.value === null;
}
