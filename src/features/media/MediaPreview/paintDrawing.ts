import {
  BlendMode,
  BlurStyle,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkCanvas,
  type SkPaint,
  type SkPath,
  type SkShader,
} from '@shopify/react-native-skia';

import {
  arrowHead,
  BLUR_EDGE,
  drawingPlan,
  MARKER_OPACITY,
  smoothPath,
  type DrawBrush,
  type DrawOp,
  type PhotoDrawing,
} from '@/features/media/photoEdits/drawing';

/**
 * Рисунок → команды Skia. Одни и те же функции собирают слои живого показа
 * (`drawingLayers.ts`), плитку и запекание (`bake.ts`), поэтому отправленное
 * совпадает с увиденным. Холст здесь всегда в единицах рисунка — долях
 * ширины исходника; в пиксели их переводит матрица холста.
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

/**
 * Применить к слою его штрихи по порядку. Холст — уже со своим слоем:
 * ластик (`Clear`) вычищает пиксели именно этого слоя, а не фото под ним.
 *
 * Мазок размытия — размытое фото `blur`, проявленное сквозь мягкую маску
 * штриха. Мазок за мазком это то же, что общая маска и одно проявление, —
 * поэтому слой можно и дописывать по одному штриху, и собирать заново.
 */
export function paintOps(canvas: SkCanvas, ops: DrawOp[], blur: SkShader | null) {
  for (const { erase, stroke } of ops) {
    const path = strokePath(stroke.points, stroke.brush, stroke.width, true);

    if (erase) {
      const paint = strokePaint(stroke.width, StrokeCap.Round);

      paint.setBlendMode(BlendMode.Clear);
      canvas.drawPath(path, paint);
      continue;
    }

    if (stroke.brush === 'blur') {
      if (!blur) continue;

      const edge = stroke.width * BLUR_EDGE;
      const mask = strokePaint(stroke.width, StrokeCap.Round);
      const bounds = path.computeTightBounds();
      const pad = stroke.width + edge * 3;

      mask.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, edge, true));

      const reveal = Skia.Paint();

      reveal.setShader(blur);
      reveal.setBlendMode(BlendMode.SrcIn);

      canvas.saveLayer(
        undefined,
        Skia.XYWHRect(
          bounds.x - pad,
          bounds.y - pad,
          bounds.width + pad * 2,
          bounds.height + pad * 2,
        ),
      );
      canvas.drawPath(path, mask);
      canvas.drawPaint(reveal);
      canvas.restore();
      continue;
    }

    const paint = strokePaint(stroke.width, brushCap(stroke.brush));

    paint.setColor(Skia.Color(stroke.color));
    if (stroke.brush === 'marker') paint.setAlphaf(MARKER_OPACITY);
    canvas.drawPath(path, paint);
  }
}

/**
 * Весь рисунок поверх фото, уже нарисованного на холсте: слой размытия,
 * затем слой линий, каждый в своём слое холста — ластик стирает рисунок, а
 * не фото. `blur` — размытое фото (уже с цветом) в единицах рисунка.
 */
export function paintDrawing(canvas: SkCanvas, strokes: PhotoDrawing, blur: SkShader | null) {
  const plan = drawingPlan(strokes);

  for (const ops of [plan.blur, plan.lines]) {
    if (ops.length === 0) continue;

    canvas.saveLayer();
    paintOps(canvas, ops, blur);
    canvas.restore();
  }
}
