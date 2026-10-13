import { prepareAvatar, type PreparedAvatar } from './lib/prepareAvatar';
import { resolveAssetUri, type MediaLibraryItem } from './mediaLibrary';
import { bakedPhotoOf } from './photoEdits/editsStore';

/**
 * Фото из галереи — в файл аватарки: с правкой редактора — её запекание,
 * без правки — исходник. Дальше квадрат по центру и сжатие (`prepareAvatar`):
 * у обрезанного фото рамка уже квадратная, у необрезанного в круге и был
 * центральный квадрат.
 *
 * Запечённая правка берётся в момент вызова — правки шита аватарки живут,
 * только пока открыто его окно.
 */
export function prepareAvatarFrom(asset: MediaLibraryItem): Promise<PreparedAvatar> {
  const baked = bakedPhotoOf(asset.id);

  if (baked) {
    // Запекание идёт из рабочей копии, повёрнутой по EXIF, — размеры у неё верные.
    return baked.prepare().then((file) => prepareAvatar(file.uri, file.width, file.height));
  }

  // Размеры из медиатеки не учитывают поворот снимка — обрезка берёт их у
  // самой картинки.
  return resolveAssetUri(asset.id).then((source) => prepareAvatar(source, null, null));
}
