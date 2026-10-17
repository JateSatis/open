import { Skia, TextAlign, type SkImage } from '@shopify/react-native-skia';

import { ClusterLook } from '@/theme';

/** Плитка силуэтов: картинка в пикселях и её размер в точках. */
export type PatternTile = { image: SkImage; width: number; height: number };

const tiles = new Map<string, PatternTile | null>();

/**
 * Плитка силуэтов эмодзи на две строки текста: в строке — один силуэт по
 * центру шага, вторая строка сдвинута на долю шага (шахматка). Цвета в
 * плитке нет — его ставит заливка (`srcIn`), поэтому плитка одна на эмодзи и
 * размер строки, а не на цвет. Кешируется: облачко в режиме одно, а
 * эмодзи-лидеров на нём немного.
 */
export function patternTile(emoji: string, lineHeight: number, scale: number): PatternTile | null {
  const icon = lineHeight * ClusterLook.patternIcon;
  const width = icon * ClusterLook.patternStep;
  const height = lineHeight * 2;
  const key = `${emoji}|${Math.round(lineHeight * scale)}|${scale}`;

  if (tiles.has(key)) return tiles.get(key) ?? null;

  const surface = Skia.Surface.Make(Math.ceil(width * scale), Math.ceil(height * scale));

  if (!surface) return null;

  const canvas = surface.getCanvas();
  const paragraph = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center })
    .pushStyle({ fontSize: icon * scale, color: Skia.Color('black') })
    .addText(emoji)
    .build();
  const box = icon * 2 * scale;

  paragraph.layout(box);

  const glyphHeight = paragraph.getHeight();
  const draw = (centerX: number, centerY: number) =>
    paragraph.paint(canvas, centerX * scale - box / 2, centerY * scale - glyphHeight / 2);

  const shifted = width * ClusterLook.patternRowShift;

  draw(width / 2, lineHeight / 2);
  // Сдвинутый силуэт попадает на край плитки — рисуется с обеих сторон,
  // повтор плитки сшивает половинки.
  draw((width / 2 + shifted) % width, lineHeight * 1.5);
  draw(((width / 2 + shifted) % width) + width, lineHeight * 1.5);
  draw(((width / 2 + shifted) % width) - width, lineHeight * 1.5);

  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  const raster = snapshot.makeNonTextureImage();

  surface.dispose();
  if (raster && raster !== snapshot) snapshot.dispose();

  const tile = { image: raster ?? snapshot, width, height };

  tiles.set(key, tile);

  return tile;
}
