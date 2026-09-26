/**
 * Доступ к галерее устройства для кастомного грида выбора медиа. Системный
 * пикер (`pickMedia.ts`) сюда не годится — грид рисуется полностью своей
 * версткой, а не встроенным UI, значит нужен прямой доступ к последним
 * файлам через `expo-media-library`.
 */
import {
  Asset,
  AssetField,
  getPermissionsAsync,
  MediaType,
  Query,
  requestPermissionsAsync,
} from 'expo-media-library';
import { getAssetsAsync } from 'expo-media-library/legacy';

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

/**
 * То же, что `requestMediaLibraryAccess`, но без системного запроса: только
 * узнать, выдан ли доступ. Нужно прогреву галереи — спрашивать разрешение в
 * момент, когда человек его не ждёт, нельзя.
 */
export async function checkMediaLibraryAccess(): Promise<LibraryAccess> {
  const response = await getPermissionsAsync(false, ['photo', 'video']);

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
  const limit = params.limit ?? MediaLimits.gallery.firstChunk;

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

/**
 * Сколько всего фото и видео в галерее. Нужно ровно для одного: длина списка
 * должна быть честной с первого кадра, чтобы скелет занимал столько клеток,
 * сколько их будет на самом деле, а не «экран с запасом».
 *
 * Считает legacy-API: у нового `Query` метода вроде `exeForCount` нет вовсе
 * (проверено по `Query.d.ts` в SDK 57 — там только `exe` и `exeForMetadata`),
 * а `getAssetsAsync` отдаёт `totalCount` рядом с первой же страницей.
 * Запрашивается один файл: считает его не клиент, а сама медиатека своим
 * `COUNT(*)` по индексу.
 *
 * Цена измерена на устройстве, см. отчёт по задаче; если бы она оказалась
 * сравнимой с чтением первого куска, смысла в отдельном запросе не было бы.
 */
export async function countRecentMedia(): Promise<number | null> {
  const startedAt = performance.now();

  try {
    const page = await getAssetsAsync({ first: 1, mediaType: ['photo', 'video'] });

    perfLog('countRecentMedia', {
      total: page.totalCount,
      ms: Math.round(performance.now() - startedAt),
    });

    return page.totalCount;
  } catch (error) {
    // Счётчик — удобство, а не условие работы грида: без него список просто
    // начнёт со скелета на экран и дорастёт до настоящей длины.
    perfLog('countRecentMedia: не вышло', { error: String(error) });

    return null;
  }
}
