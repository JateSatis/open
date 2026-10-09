import {
  FilterMode,
  MipmapMode,
  Skia,
  TileMode,
  type SkImage,
  type SkShader,
} from '@shopify/react-native-skia';

import { paintOps } from './paintDrawing';

import { perfLog } from '@/features/media/perf';
import {
  BLUR_SIGMA,
  drawingPlan,
  hasBlur,
  type DrawOp,
  type DrawStroke,
  type PhotoDrawing,
} from '@/features/media/photoEdits/drawing';

/**
 * Рисунок живого показа, сведённый в две картинки размером с рабочую копию:
 * сотня штрихов не перерисовывается векторно на каждом кадре, кадр рисует
 * две готовые картинки. Пиксель слоя — пиксель рабочей копии, поэтому слои
 * кладутся той же матрицей, что и само фото.
 *
 * Размытие здесь — размытая копия без цвета, а цвет на него накладывает
 * показ: матрица цвета и размытие перестановочны, и ползунки цвета меняют
 * размытое место вживую, без пересборки слоя.
 */
export type DrawingLayers = { blur: SkImage | null; lines: SkImage | null };

export const NO_LAYERS: DrawingLayers = { blur: null, lines: null };

/** Столько фото держат слои в памяти — по ~8 МБ на слой. */
const LAYERS_KEPT = 4;
const BLURRED_KEPT = 2;

const layersCache = new Map<string, { strokes: PhotoDrawing; layers: DrawingLayers }>();
const blurredCache = new Map<string, { image: SkImage; blurred: SkImage }>();

function keep<V>(cache: Map<string, V>, id: string, value: V, limit: number) {
  cache.delete(id);
  cache.set(id, value);

  if (cache.size > limit) {
    const oldest = cache.keys().next().value;

    // Не `dispose`: вытесненное ещё может рисовать соседняя страница.
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Картинка в пикселях `unitPx` на единицу → шейдер в единицах рисунка. */
export function unitsShader(image: SkImage, unitPx: number): SkShader {
  return image.makeShaderOptions(
    TileMode.Clamp,
    TileMode.Clamp,
    FilterMode.Linear,
    MipmapMode.None,
    Skia.Matrix().scale(1 / unitPx, 1 / unitPx),
  );
}

/** Размытая рабочая копия — одна на фото: её проявляют мазки размытия. */
export function blurredCopyOf(id: string, image: SkImage): SkImage {
  const known = blurredCache.get(id);

  if (known && known.image === image) {
    keep(blurredCache, id, known, BLURRED_KEPT);
    return known.blurred;
  }

  const startedAt = performance.now();
  const width = image.width();
  const surface = Skia.Surface.Make(width, image.height());

  if (!surface) throw new Error('Не удалось создать поверхность для размытия');

  const sigma = BLUR_SIGMA * width;
  const paint = Skia.Paint();

  paint.setImageFilter(Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Clamp, null));
  surface.getCanvas().drawImage(image, 0, 0, paint);
  surface.flush();

  const blurred = surface.makeImageSnapshot();

  surface.dispose();
  keep(blurredCache, id, { image, blurred }, BLURRED_KEPT);
  perfLog('рисунок: размытая копия', { id, ms: Math.round(performance.now() - startedAt) });

  return blurred;
}

/** Слой поверх прежнего: прежний — как есть, новые штрихи — по порядку. */
function renderLayer(
  image: SkImage,
  ops: DrawOp[],
  blur: SkShader | null,
  base: SkImage | null,
): SkImage | null {
  if (ops.length === 0) return base;

  const width = image.width();
  const surface = Skia.Surface.Make(width, image.height());

  if (!surface) throw new Error('Не удалось создать поверхность для рисунка');

  const canvas = surface.getCanvas();

  if (base) canvas.drawImage(base, 0, 0);
  canvas.save();
  canvas.scale(width, width);
  paintOps(canvas, ops, blur);
  canvas.restore();
  surface.flush();

  const layer = surface.makeImageSnapshot();

  surface.dispose();

  return layer;
}

function blurShaderFor(id: string, image: SkImage, strokes: PhotoDrawing): SkShader | null {
  return hasBlur(strokes) ? unitsShader(blurredCopyOf(id, image), image.width()) : null;
}

/** Слои рисунка целиком, с нуля. */
function renderLayers(id: string, image: SkImage, strokes: PhotoDrawing): DrawingLayers {
  if (strokes.length === 0) return NO_LAYERS;

  const startedAt = performance.now();
  const plan = drawingPlan(strokes);
  const blur = blurShaderFor(id, image, strokes);
  const layers = {
    blur: renderLayer(image, plan.blur, blur, null),
    lines: renderLayer(image, plan.lines, null, null),
  };

  perfLog('рисунок: слои с нуля', {
    id,
    штрихов: strokes.length,
    ms: Math.round(performance.now() - startedAt),
  });

  return layers;
}

/** Слои рисунка фото: готовые из памяти, иначе — собираются. */
export function drawingLayersOf(id: string, image: SkImage, strokes: PhotoDrawing): DrawingLayers {
  const known = layersCache.get(id);

  if (known && known.strokes === strokes) return known.layers;

  const layers = renderLayers(id, image, strokes);

  keep(layersCache, id, { strokes, layers }, LAYERS_KEPT);

  return layers;
}

/** Слои, уже собранные инструментом, — страница возьмёт их, а не соберёт заново. */
export function rememberDrawingLayers(id: string, strokes: PhotoDrawing, layers: DrawingLayers) {
  keep(layersCache, id, { strokes, layers }, LAYERS_KEPT);
}

/**
 * Один новый штрих поверх готовых слоёв — то же, что собрать с нуля, но за
 * один штрих. Ластик стирает только в тех слоях, где уже что-то есть.
 */
export function appendDrawingStroke(
  id: string,
  image: SkImage,
  layers: DrawingLayers,
  stroke: DrawStroke,
): DrawingLayers {
  const startedAt = performance.now();
  const next = appendStroke(id, image, layers, stroke);

  perfLog('рисунок: штрих в слой', {
    id,
    кисть: stroke.brush,
    точек: stroke.points.length / 2,
    ms: Math.round(performance.now() - startedAt),
  });

  return next;
}

function appendStroke(
  id: string,
  image: SkImage,
  layers: DrawingLayers,
  stroke: DrawStroke,
): DrawingLayers {
  if (stroke.brush === 'eraser') {
    const op = [{ erase: true, stroke }];

    return {
      blur: layers.blur && renderLayer(image, op, null, layers.blur),
      lines: layers.lines && renderLayer(image, op, null, layers.lines),
    };
  }

  const op = [{ erase: false, stroke }];

  if (stroke.brush === 'blur') {
    return {
      ...layers,
      blur: renderLayer(image, op, blurShaderFor(id, image, [stroke]), layers.blur),
    };
  }

  return { ...layers, lines: renderLayer(image, op, null, layers.lines) };
}
