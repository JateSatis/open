import type { SkImage } from '@shopify/react-native-skia';

import { blurImage, layerShader, renderLayer } from './paintDrawing';

import { perfLog } from '@/features/media/perf';
import type { Affine } from '@/features/media/photoEdits/crop';
import {
  BLUR_SIGMA,
  drawingPlan,
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
 * Мазок размытия в слое размытия — размытая копия без цвета, а цвет на неё
 * накладывает показ: матрица цвета и размытие перестановочны, и ползунки
 * цвета меняют размытое место вживую, без пересборки слоя. В слое линий
 * тот же мазок замазывает уже нарисованное — линии под ним размываются, а
 * цветом они не перекрашиваются, как и положено линиям.
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

/** Размытая рабочая копия — одна на фото: её проявляют мазки размытия. */
export function blurredCopyOf(id: string, image: SkImage): SkImage {
  const known = blurredCache.get(id);

  if (known && known.image === image) {
    keep(blurredCache, id, known, BLURRED_KEPT);
    return known.blurred;
  }

  const startedAt = performance.now();
  const blurred = blurImage(image, BLUR_SIGMA * image.width());

  keep(blurredCache, id, { image, blurred }, BLURRED_KEPT);
  perfLog('рисунок: размытая копия', { id, ms: Math.round(performance.now() - startedAt) });

  return blurred;
}

/** Единицы рисунка → пиксели копии. */
function copyUnits(image: SkImage): Affine {
  const width = image.width();

  return { a: width, b: 0, c: 0, d: width, tx: 0, ty: 0 };
}

/** Слой поверх прежнего: прежний — как есть, новые шаги — по порядку. */
function layerOf(
  id: string,
  image: SkImage,
  ops: DrawOp[],
  layer: 'blur' | 'lines',
  base: SkImage | null,
): SkImage | null {
  const units = copyUnits(image);
  const blurs = ops.some((op) => op.kind === 'blur');

  return renderLayer({
    width: image.width(),
    height: image.height(),
    units,
    base,
    ops,
    blur: layer === 'lines' ? 'self' : blurs ? layerShader(blurredCopyOf(id, image), units) : null,
    sigmaPx: BLUR_SIGMA * image.width(),
  });
}

/** Слои рисунка целиком, с нуля, — мимо памяти: для промежуточных шагов отмены. */
export function renderDrawingLayers(
  id: string,
  image: SkImage,
  strokes: PhotoDrawing,
): DrawingLayers {
  if (strokes.length === 0) return NO_LAYERS;

  const startedAt = performance.now();
  const plan = drawingPlan(strokes);
  const layers = {
    blur: layerOf(id, image, plan.blur, 'blur', null),
    lines: layerOf(id, image, plan.lines, 'lines', null),
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

  const layers = renderDrawingLayers(id, image, strokes);

  keep(layersCache, id, { strokes, layers }, LAYERS_KEPT);

  return layers;
}

/** Слои рисунка или их отсутствие: не собрались — фото без рисунка, а не падение показа. */
export function safeDrawingLayersOf(
  id: string,
  image: SkImage,
  drawing: PhotoDrawing | undefined,
): DrawingLayers {
  if (!drawing || drawing.length === 0) return NO_LAYERS;

  try {
    return drawingLayersOf(id, image, drawing);
  } catch (error) {
    console.warn('[photo-draw] рисунок не собрался', error);
    return NO_LAYERS;
  }
}

/** Столько ждём, прежде чем освободить сменённый слой: UI-поток мог ещё рисовать его кадр. */
const RETIRE_AFTER_MS = 1000;

/**
 * Освободить слои, сменённые новыми, — сразу, а не когда до них дойдёт
 * сборщик мусора: каждый слой — мегабайты нативной памяти, а сборщик о них
 * не знает, и сотня штрихов съела бы сотни мегабайт. Слои из `keep` (на
 * входе в инструмент, в памяти страниц) не трогаются.
 */
export function retireDrawingLayers(
  old: DrawingLayers,
  next: DrawingLayers,
  kept: DrawingLayers[],
) {
  const cached = [...layersCache.values()].map((entry) => entry.layers);
  const alive = new Set(
    [next, ...kept, ...cached].flatMap((layers) => [layers.blur, layers.lines]),
  );
  const dead = [old.blur, old.lines].filter(
    (image): image is SkImage => image !== null && !alive.has(image),
  );

  if (dead.length === 0) return;

  setTimeout(() => dead.forEach((image) => image.dispose()), RETIRE_AFTER_MS);
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
  if (stroke.brush === 'eraser' || stroke.brush === 'blur') {
    // Ластик и замазывание — в обоих слоях; в линиях — только если там уже что-то есть.
    const kind = stroke.brush === 'eraser' ? 'erase' : 'blur';
    const op = [{ kind, stroke } as const];
    const blur =
      kind === 'blur' || layers.blur ? layerOf(id, image, op, 'blur', layers.blur) : null;

    return {
      blur,
      lines: layers.lines && layerOf(id, image, op, 'lines', layers.lines),
    };
  }

  return {
    ...layers,
    lines: layerOf(id, image, [{ kind: 'paint', stroke }], 'lines', layers.lines),
  };
}

/** Размытая копия слоя линий — её проявляет мазок размытия под пальцем. */
export function blurredLinesOf(image: SkImage, lines: SkImage | null): SkImage | null {
  return lines && blurImage(lines, BLUR_SIGMA * image.width());
}
