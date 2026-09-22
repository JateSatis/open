/**
 * Доступ к галерее устройства для кастомного грида выбора медиа. Системный
 * пикер (`pickMedia.ts`) сюда не годится — грид рисуется полностью своей
 * версткой, а не встроенным UI, значит нужен прямой доступ к последним
 * файлам через `expo-media-library`.
 */
import { AssetField, MediaType, Query, requestPermissionsAsync } from 'expo-media-library';

import { MediaLimits } from './constants';
import { mimeFromUri } from './lib/mime';
import type { LocalMedia, MediaKind } from './types';

export type LibraryAsset = {
  id: string;
  kind: MediaKind;
  /** file:// URI, пригоден и для превью, и для чтения байт при отправке. */
  uri: string;
  width: number;
  height: number;
  durationMs: number | null;
};

export type LibraryAccess = 'granted' | 'denied';

/**
 * Только фото и видео: голосовые и кружки в галерею телефона не попадают, а
 * аудиофайлы устройства (музыка) для чата не нужны.
 */
export async function requestMediaLibraryAccess(): Promise<LibraryAccess> {
  const response = await requestPermissionsAsync(false, ['photo', 'video']);

  // `limited` (часть библиотеки на iOS) — рабочий режим, а не отказ: грид
  // просто покажет то, на что доступ дан.
  return response.granted || response.accessPrivileges === 'limited' ? 'granted' : 'denied';
}

function toMediaKind(mediaType: MediaType): MediaKind {
  return mediaType === MediaType.VIDEO ? 'video' : 'photo';
}

/**
 * Одна страница последних фото и видео, новые сначала. `getInfo()` даёт uri
 * и метаданные одним нативным вызовом на файл — дешевле, чем собирать их
 * по отдельным геттерам `Asset`.
 */
export async function queryRecentMedia(params: {
  offset: number;
  limit?: number;
}): Promise<LibraryAsset[]> {
  const limit = params.limit ?? MediaLimits.gallery.pageSize;

  const assets = await new Query()
    .within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO])
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .offset(params.offset)
    .limit(limit)
    .exe();

  const infos = await Promise.all(assets.map((asset) => asset.getInfo()));

  return infos.map((info) => ({
    id: info.id,
    kind: toMediaKind(info.mediaType),
    uri: info.uri,
    width: info.width,
    height: info.height,
    durationMs: info.duration,
  }));
}

/**
 * Галерея не сообщает MIME-тип напрямую (только тип медиа), поэтому он
 * выводится из расширения файла — тот же приём, что и в системном пикере.
 */
export function libraryAssetToLocalMedia(asset: LibraryAsset): LocalMedia {
  const fallbackMime = asset.kind === 'video' ? 'video/mp4' : 'image/jpeg';

  return {
    kind: asset.kind,
    uri: asset.uri,
    mimeType: mimeFromUri(asset.uri, fallbackMime),
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
  };
}
