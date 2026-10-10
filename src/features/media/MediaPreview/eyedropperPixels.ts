import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';

import type { DrawingLayers } from './drawingLayers';
import type { DrawGeometry } from './drawGeometry';
import { screenToUnits } from './drawGeometry';
import type { Rect } from './previewStore';

import { adjustColorMatrix } from '@/features/media/photoEdits/colorMatrix';
import { cropTransform, type PhotoCrop } from '@/features/media/photoEdits/crop';
import { rgbHex } from '@/features/media/photoEdits/drawing';
import type { ColorAdjust } from '@/features/media/photoEdits/types';

/**
 * Пипетка берёт цвет из того, что видно на фото: рабочая копия с правкой
 * цвета, с размытием и с нарисованными линиями — в пикселях рабочей копии,
 * а не экрана. Собирается один раз, когда пипетку взяли, в обычной памяти
 * (не на видеокарте): чтение одного пикселя из неё на UI-потоке — дёшево и
 * без задержки.
 */
export function visibleImageOf(
  image: SkImage,
  adjust: ColorAdjust,
  layers: DrawingLayers,
): SkImage | null {
  const width = image.width();
  const height = image.height();
  const surface = Skia.Surface.Make(width, height);

  if (!surface) return null;

  const canvas = surface.getCanvas();
  const colored = Skia.Paint();

  // Порядок — как у показа и запекания: фото и размытие под цветом, линии поверх.
  colored.setColorFilter(Skia.ColorFilter.MakeMatrix(adjustColorMatrix(adjust)));
  canvas.drawImage(image, 0, 0, colored);
  if (layers.blur) canvas.drawImage(layers.blur, 0, 0, colored);
  if (layers.lines) canvas.drawImage(layers.lines, 0, 0);
  surface.flush();

  const snapshot = surface.makeImageSnapshot();
  const raster = snapshot.makeNonTextureImage();

  surface.dispose();
  if (raster && raster !== snapshot) snapshot.dispose();

  return raster ?? snapshot;
}

/** Цвет пикселя `#rrggbb`; не прочитался — `null`. */
export function samplePixel(sample: SkImage, x: number, y: number): string | null {
  'worklet';
  const px = Math.min(sample.width() - 1, Math.max(0, Math.floor(x)));
  const py = Math.min(sample.height() - 1, Math.max(0, Math.floor(y)));
  const pixel = sample.readPixels(px, py, {
    width: 1,
    height: 1,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });

  if (!pixel || pixel.length < 3) return null;

  return rgbHex(pixel[0], pixel[1], pixel[2]);
}

/**
 * Где лупа на экране: под пальцем, но целиком внутри видимого фото — не
 * выходит за края и не залезает под вырез (фото и так ниже выреза). Фото
 * уже лупы — лупа по центру.
 */
export function loupeCenter(
  frame: Rect,
  radius: number,
  x: number,
  y: number,
): { x: number; y: number } {
  'worklet';
  const within = (value: number, start: number, side: number) =>
    side < radius * 2
      ? start + side / 2
      : Math.min(start + side - radius, Math.max(start + radius, value));

  return { x: within(x, frame.x, frame.width), y: within(y, frame.y, frame.height) };
}

/** Точка экрана → пиксель рабочей копии: сквозь ужатие, увеличение и обрезку, как у штриха. */
export function screenToPixel(
  g: DrawGeometry,
  imageWidth: number,
  x: number,
  y: number,
): { x: number; y: number } {
  'worklet';
  const units = screenToUnits(g, x, y);

  return { x: units.x * imageWidth, y: units.y * imageWidth };
}

/**
 * Матрица картинки в лупе: пиксель `pixel` — ровно в центре лупы, каждый
 * пиксель — клетка `cell` точек, повёрнут и отражён так же, как фото на
 * экране, — палец ведёт лупу туда же, куда видит.
 */
export function loupeMatrix(
  crop: PhotoCrop,
  center: { x: number; y: number },
  pixel: { x: number; y: number },
  cell: number,
): number[] {
  'worklet';
  const linear = cropTransform(crop, { x: 0, y: 0, width: 1, height: 1 }, 1);
  const scale = Math.sqrt(Math.abs(linear.a * linear.d - linear.b * linear.c)) || 1;
  const a = (linear.a / scale) * cell;
  const b = (linear.b / scale) * cell;
  const c = (linear.c / scale) * cell;
  const d = (linear.d / scale) * cell;
  // Середина пикселя, а не его угол, — в центр лупы.
  const px = Math.floor(pixel.x) + 0.5;
  const py = Math.floor(pixel.y) + 0.5;

  return [a, c, center.x - (a * px + c * py), b, d, center.y - (b * px + d * py), 0, 0, 1];
}
