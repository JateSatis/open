import type { MediaLibraryItem } from '../mediaLibrary';

/**
 * Ссылка на превью файла — это его собственный `id`, и запрашивать для неё
 * ничего не нужно: на Android `id` это `content://media/external/images/media/N`,
 * на iOS — `ph://<localIdentifier>`. `expo-image` открывает оба вида напрямую
 * (на Android через Glide, на iOS через PhotoLibraryAssetLoader), у видео
 * берёт кадр.
 *
 * Раньше путь к файлу резолвился через `Asset.getUri()`, а кадр видео снимался
 * через `expo-video-thumbnails`. Замер показал цену: 200 вызовов `getUri` и
 * 206 вызовов `getThumbnailAsync` на одно открытие шита, причём один кадр
 * видео обходился в 280–537 мс.
 *
 * Лежит отдельно от `mediaLibrary.ts` намеренно: тут нужен только тип, а не
 * нативный модуль, и клетка грида не тянет за собой `expo-media-library`.
 */
export function assetPreviewUri(item: Pick<MediaLibraryItem, 'id'>): string {
  return item.id;
}
