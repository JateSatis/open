import { Skia, TextAlign, type SkImage } from '@shopify/react-native-skia';

import { ClusterLook } from '@/theme';

const tiles = new Map<string, SkImage | null>();

/** Высота строки в пикселях плитки: целая, чтобы повтор шёл ровно по строкам. */
export function tileLine(lineHeight: number, scale: number): number {
  return Math.max(1, Math.round(lineHeight * scale));
}

/**
 * Плитка силуэтов эмодзи на две строки текста: в строке — один силуэт по
 * центру шага, вторая строка сдвинута на долю шага (шахматка). Цвета в
 * плитке нет — его ставит заливка (`srcIn`), поэтому плитка одна на эмодзи и
 * высоту строки, а не на цвет. Размеры — целые пиксели: на них же идёт
 * повтор, и сшитые на краю половинки силуэта совпадают.
 */
export function patternTile(emoji: string, lineHeight: number, scale: number): SkImage | null {
  const line = tileLine(lineHeight, scale);
  const key = `${emoji}|${line}|${scale}`;

  if (tiles.has(key)) return tiles.get(key) ?? null;

  const icon = line * ClusterLook.patternIcon;
  const width = Math.max(1, Math.round(icon * ClusterLook.patternStep));
  const surface = Skia.Surface.Make(width, line * 2);

  if (!surface) return null;

  const canvas = surface.getCanvas();
  const paragraph = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center })
    .pushStyle({ fontSize: icon, color: Skia.Color('black') })
    .addText(emoji)
    .build();
  const box = icon * 2;

  paragraph.layout(box);

  const glyphHeight = paragraph.getHeight();
  const draw = (centerX: number, centerY: number) =>
    paragraph.paint(canvas, centerX - box / 2, centerY - glyphHeight / 2);
  const shifted = (width / 2 + width * ClusterLook.patternRowShift) % width;

  draw(width / 2, line / 2);
  // Сдвинутый силуэт попадает на край плитки — рисуется с обеих сторон,
  // повтор плитки сшивает половинки.
  draw(shifted - width, line * 1.5);
  draw(shifted, line * 1.5);
  draw(shifted + width, line * 1.5);

  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  const raster = snapshot.makeNonTextureImage();

  surface.dispose();
  if (raster && raster !== snapshot) snapshot.dispose();

  const tile = raster ?? snapshot;

  tiles.set(key, tile);

  return tile;
}
