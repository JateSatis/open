import { libraryAssetToLocalMedia, resolveLibraryAsset, type MediaLibraryItem } from '../mediaLibrary';
import { assetPreviewUri } from '../lib/previewUri';
import type { LocalMedia } from '../types';
import type { BakedPhoto } from './types';

/**
 * Выбранный файл галереи, как его получает отправка: сам файл и, если фото
 * правилось, — его запечённая версия. Сообщение, комментарий и добавление
 * фото в правку альбома берут превью и байты только через функции ниже, а не
 * каждый по-своему.
 */
export type OutgoingMedia = MediaLibraryItem & { edited?: BakedPhoto };

export type OutgoingPreview = {
  url: string;
  width: number | null;
  height: number | null;
};

/**
 * Что показать в облачке до ответа сервера. Отредактированное — сразу
 * итоговой картинкой, не оригиналом. Не запеклось — пустое место (облачко
 * упадёт с «повторить» на загрузке), а не оригинал под видом правки.
 */
export function outgoingPreview(item: OutgoingMedia): OutgoingPreview {
  if (item.edited) {
    try {
      const file = item.edited.file();

      return { url: file.uri, width: file.width, height: file.height };
    } catch {
      return { url: '', width: item.width, height: item.height };
    }
  }

  return { url: assetPreviewUri(item), width: item.width, height: item.height };
}

/**
 * Файл к загрузке. Отредактированное уже в итоговом размере и качестве
 * (`MediaLimits.photo`): второй раз его не сжимают — двойное JPEG-сжатие
 * портит картинку.
 */
export async function outgoingLocalMedia(item: OutgoingMedia): Promise<LocalMedia> {
  if (item.edited) {
    const file = item.edited.file();

    return {
      kind: 'photo',
      uri: file.uri,
      mimeType: 'image/jpeg',
      width: file.width,
      height: file.height,
      durationMs: null,
      prepared: true,
    };
  }

  // Путь к файлу мог не резолвиться к моменту выбора — добираем его здесь,
  // там, где байты действительно нужны.
  return libraryAssetToLocalMedia(await resolveLibraryAsset(item));
}
