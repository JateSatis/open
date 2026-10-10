import {
  BlendMode,
  FilterMode,
  MipmapMode,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  type SkImage,
  type SkPaint,
  type SkPath,
  type SkShader,
  type SkSurface,
} from '@shopify/react-native-skia';

import { affineToMatrix, invertAffine, type Affine } from '@/features/media/photoEdits/crop';
import {
  arrowHead,
  brushPaintColor,
  smoothPath,
  type DrawBrush,
  type DrawOp,
} from '@/features/media/photoEdits/drawing';

/**
 * Рисунок → команды Skia. Одни и те же функции собирают слои живого показа
 * (`drawingLayers.ts`), плитку и запекание (`bake.ts`), поэтому отправленное
 * совпадает с увиденным. Штрихи — в единицах рисунка (долях ширины
 * исходника), в пиксели слоя их переводит матрица `units`.
 */

/** Сглаженная линия штриха; у стрелки с наконечником, если он уже положен. */
export function strokePath(
  points: number[],
  brush: DrawBrush,
  width: number,
  head: boolean,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();

  for (const command of smoothPath(points)) {
    if (command.kind === 'move') path.moveTo(command.x, command.y);
    else if (command.kind === 'line') path.lineTo(command.x, command.y);
    else path.quadTo(command.cx, command.cy, command.x, command.y);
  }

  if (brush === 'arrow' && head) {
    const tip = arrowHead(points, width);

    if (tip) {
      path.moveTo(tip.left[0], tip.left[1]);
      path.lineTo(tip.tipX, tip.tipY);
      path.lineTo(tip.right[0], tip.right[1]);
    }
  }

  return path;
}

/** Маркер — плоский, как текстовыделитель; остальное — круглое. */
export function brushCap(brush: DrawBrush): StrokeCap {
  'worklet';
  return brush === 'marker' ? StrokeCap.Square : StrokeCap.Round;
}

function strokePaint(width: number, cap: StrokeCap): SkPaint {
  const paint = Skia.Paint();

  paint.setAntiAlias(true);
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(width);
  paint.setStrokeCap(cap);
  paint.setStrokeJoin(StrokeJoin.Round);

  return paint;
}

/** Уменьшение перед размытием: сигма на маленькой копии — не больше стольких пикселей. */
const BLUR_SMALL_SIGMA = 4;

/**
 * Сильно размытая копия картинки того же размера. Большая сигма на полном
 * размере — дорого, поэтому картинка уменьшается, размывается там и
 * растягивается обратно: на глаз то же, в десятки раз быстрее. Края
 * продолжаются своими пикселями — у края фото размытие не темнеет.
 */
export function blurImage(image: SkImage, sigma: number): SkImage {
  const width = image.width();
  const height = image.height();
  const factor = Math.max(1, Math.floor(sigma / BLUR_SMALL_SIGMA));
  const smallWidth = Math.max(1, Math.ceil(width / factor));
  const smallHeight = Math.max(1, Math.ceil(height / factor));
  const small = Skia.Surface.Make(smallWidth, smallHeight);
  const blurredSmall = Skia.Surface.Make(smallWidth, smallHeight);
  const full = Skia.Surface.Make(width, height);

  if (!small || !blurredSmall || !full) {
    throw new Error('Не удалось создать поверхность для размытия');
  }

  small
    .getCanvas()
    .drawImageRectOptions(
      image,
      Skia.XYWHRect(0, 0, width, height),
      Skia.XYWHRect(0, 0, smallWidth, smallHeight),
      FilterMode.Linear,
      MipmapMode.Linear,
    );
  small.flush();

  const reduced = small.makeImageSnapshot();
  const paint = Skia.Paint();
  const smallSigma = sigma / factor;

  paint.setImageFilter(Skia.ImageFilter.MakeBlur(smallSigma, smallSigma, TileMode.Clamp, null));
  blurredSmall.getCanvas().drawImage(reduced, 0, 0, paint);
  blurredSmall.flush();

  const reducedBlurred = blurredSmall.makeImageSnapshot();

  full
    .getCanvas()
    .drawImageRectOptions(
      reducedBlurred,
      Skia.XYWHRect(0, 0, smallWidth, smallHeight),
      Skia.XYWHRect(0, 0, width, height),
      FilterMode.Linear,
      MipmapMode.None,
    );
  full.flush();

  const blurred = full.makeImageSnapshot();

  reduced.dispose();
  reducedBlurred.dispose();
  small.dispose();
  blurredSmall.dispose();
  full.dispose();

  return blurred;
}

/** Картинка в пикселях слоя → шейдер в единицах рисунка. */
export function layerShader(image: SkImage, units: Affine): SkShader {
  return image.makeShaderOptions(
    TileMode.Clamp,
    TileMode.Clamp,
    FilterMode.Linear,
    MipmapMode.None,
    Skia.Matrix(affineToMatrix(invertAffine(units))),
  );
}

export type LayerParams = {
  width: number;
  height: number;
  /** Единицы рисунка → пиксели слоя. */
  units: Affine;
  /** Слой до этих шагов; нет — пустой. */
  base: SkImage | null;
  ops: DrawOp[];
  /**
   * Чем замазывает мазок размытия: размытым фото (слой размытия, шейдер в
   * единицах рисунка) или — `self` — размытой копией того, что в слое уже
   * нарисовано (слой линий).
   */
  blur: SkShader | 'self' | null;
  /** Сила размытия в пикселях слоя — для `self`. */
  sigmaPx: number;
};

/** Размытая копия того, что сейчас на поверхности, — шейдером в единицах рисунка. */
function selfBlur(surface: SkSurface, params: LayerParams): { shader: SkShader; image: SkImage } {
  surface.flush();

  const sharp = surface.makeImageSnapshot();
  const image = blurImage(sharp, params.sigmaPx);

  sharp.dispose();

  return { shader: layerShader(image, params.units), image };
}

/**
 * Слой рисунка: прежний слой и шаги по порядку истории. Ластик вычищает
 * пиксели слоя; мазок размытия заменяет их размытой копией — с чётким краем,
 * и то, что под ним было, не просвечивает. Перо, стрелка и маркер ложатся
 * поверх. Слой можно и дописывать по шагу, и собирать заново — выйдет одно и то же.
 */
export function renderLayer(params: LayerParams): SkImage | null {
  const { width, height, units, base, ops } = params;

  if (ops.length === 0) return base;

  const surface = Skia.Surface.Make(width, height);

  if (!surface) throw new Error('Не удалось создать поверхность для рисунка');

  const canvas = surface.getCanvas();
  const matrix = Skia.Matrix(affineToMatrix(units));

  if (base) canvas.drawImage(base, 0, 0);

  for (const { kind, stroke } of ops) {
    const path = strokePath(stroke.points, stroke.brush, stroke.width, true);
    let paint: SkPaint;
    let scratch: SkImage | null = null;

    if (kind === 'erase') {
      paint = strokePaint(stroke.width, StrokeCap.Round);
      paint.setBlendMode(BlendMode.Clear);
    } else if (kind === 'blur') {
      let shader: SkShader | null = null;

      if (params.blur === 'self') {
        const blurred = selfBlur(surface, params);

        shader = blurred.shader;
        scratch = blurred.image;
      } else {
        shader = params.blur;
      }

      if (!shader) continue;

      paint = strokePaint(stroke.width, StrokeCap.Round);
      paint.setShader(shader);
      paint.setBlendMode(BlendMode.Src);
    } else {
      paint = strokePaint(stroke.width, brushCap(stroke.brush));
      paint.setColor(Skia.Color(brushPaintColor(stroke.color, stroke.brush)));
    }

    canvas.save();
    canvas.concat(matrix);
    canvas.drawPath(path, paint);
    canvas.restore();
    scratch?.dispose();
  }

  surface.flush();

  const layer = surface.makeImageSnapshot();

  surface.dispose();

  return layer;
}
