/**
 * Доступ к галерее устройства для кастомного грида выбора медиа. Системный
 * пикер (`pickMedia.ts`) сюда не годится — грид рисуется полностью своей
 * версткой, а не встроенным UI, значит нужен прямой доступ к последним
 * файлам через `expo-media-library`.
 */
import { Asset, AssetField, MediaType, Query, requestPermissionsAsync } from 'expo-media-library';

import { MediaLimits } from './constants';
import { perfLog, perfTime } from './perf';
import { mimeFromUri } from './lib/mime';
import type { LocalMedia, MediaKind } from './types';

/**
 * Строка грида до того, как файл выбран. `exeForMetadata()` отдаёт эти поля
 * дёшево, без похода к файловой системе за путём — значит известно, сколько
 * клеток рисовать, ещё до того, как хоть один файл готов открыться.
 */
export type MediaLibraryItem = {
  id: string;
  kind: MediaKind;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

export type LibraryAsset = MediaLibraryItem & {
  /**
   * file:// URI — пригоден и для превью, и для чтения байт при отправке.
   * `null`, пока путь не резолвился: выбор файла в гриде не ждёт похода в
   * файловую систему, путь догоняет выбор (см. `resolveLibraryAsset`).
   */
  uri: string | null;
};

/** Тот же файл, но уже с путём — всё, что читает байты, требует именно его. */
export type ResolvedLibraryAsset = LibraryAsset & { uri: string };

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
 * Одна страница последних фото и видео, новые сначала. `exeForMetadata()`
 * читает эти поля прямо из индекса медиатеки, не трогая файлы на диске —
 * страница готова сразу, а не только после того, как каждый файл в ней
 * получит свой путь. Путь (`uri`) резолвится отдельно и лениво, см.
 * `resolveAssetUri`.
 */
export async function queryRecentMedia(params: {
  offset: number;
  limit?: number;
}): Promise<MediaLibraryItem[]> {
  const limit = params.limit ?? MediaLimits.gallery.chunk;

  const startedAt = performance.now();
  const assets = await new Query()
    .within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO])
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .offset(params.offset)
    .limit(limit)
    .exeForMetadata();

  perfLog('queryRecentMedia', {
    offset: params.offset,
    limit,
    got: assets.length,
    ms: Math.round(performance.now() - startedAt),
  });

  return assets.map((info) => ({
    id: info.id,
    kind: toMediaKind(info.mediaType),
    width: info.width,
    height: info.height,
    durationMs: info.duration,
  }));
}

/**
 * `uri` файла нужен ровно в одном месте — когда пора читать байты для
 * отправки. Для показа он не нужен, см. `assetPreviewUri`.
 */
export function resolveAssetUri(id: string): Promise<string> {
  return perfTime('getUri', () => new Asset(id).getUri());
}

/**
 * Путь к файлу нужен только к отправке, поэтому и добирается только там:
 * в гриде выбранный файл хранится без него.
 */
export async function resolveLibraryAsset(
  asset: MediaLibraryItem | LibraryAsset,
): Promise<ResolvedLibraryAsset> {
  const known = 'uri' in asset ? asset.uri : null;

  if (known !== null) return { ...asset, uri: known };

  return { ...asset, uri: await resolveAssetUri(asset.id) };
}

/**
 * Галерея не сообщает MIME-тип напрямую (только тип медиа), поэтому он
 * выводится из расширения файла — тот же приём, что и в системном пикере.
 */
export function libraryAssetToLocalMedia(asset: ResolvedLibraryAsset): LocalMedia {
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
