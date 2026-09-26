import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { MediaLimits } from '@/features/media/constants';

export type PreparedAvatar = { uri: string; size: number };

/**
 * Квадрат по центру, ужатый до размера аватара. Кадрирование в системном
 * редакторе уже квадратное, но на Android он иногда отдаёт на пиксель
 * неровный кадр, а камера без редактора — вовсе прямоугольный: обрезаем
 * всегда, чтобы в круге не было полей.
 */
export async function prepareAvatar(
  uri: string,
  width: number,
  height: number,
): Promise<PreparedAvatar> {
  const { sizePx, quality } = MediaLimits.avatar;
  const side = Math.min(width, height);
  const context = ImageManipulator.manipulate(uri);

  if (width !== height) {
    context.crop({
      originX: Math.floor((width - side) / 2),
      originY: Math.floor((height - side) / 2),
      width: side,
      height: side,
    });
  }

  const target = Math.min(side, sizePx);

  if (side > target) context.resize({ width: target, height: target });

  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG });

  return { uri: result.uri, size: result.width };
}
