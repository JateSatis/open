import { MediaLimits } from './constants';
import {
  checkMediaLibraryAccess,
  countRecentMedia,
  queryRecentMedia,
  type MediaLibraryItem,
} from './mediaLibrary';
import { perfLog } from './perf';

export type GallerySnapshot = {
  items: MediaLibraryItem[];
  total: number | null;
};

let snapshot: GallerySnapshot | null = null;
let inflight: Promise<void> | null = null;

/**
 * Прочитать начало галереи заранее — до того, как открыли шит.
 *
 * Без прогрева шит открывается на скелете и ждёт чтения галереи (замер:
 * 61 мс счётчик, 289 мс первые 120 файлов), и только потом начинают
 * грузиться превью. С прогревом настоящие клетки есть уже в момент, когда
 * монтируется список.
 *
 * Только если доступ к галерее уже выдан: системный запрос разрешения в
 * момент, когда человек просто зашёл в чат, недопустим.
 */
export function prefetchGallery(): void {
  if (snapshot || inflight) return;

  inflight = (async () => {
    if ((await checkMediaLibraryAccess()) !== 'granted') return;

    const [total, items] = await Promise.all([
      countRecentMedia(),
      queryRecentMedia({ offset: 0, limit: MediaLimits.gallery.firstChunk }),
    ]);

    snapshot = {
      items,
      total: items.length < MediaLimits.gallery.firstChunk ? items.length : total,
    };
    perfLog('галерея: прогрета', { файлов: items.length, всего: snapshot.total });
  })()
    .catch((error: unknown) => {
      // Прогрев — удобство: не вышло — шит прочитает галерею сам, как раньше.
      perfLog('галерея: прогрев не вышел', { error: String(error) });
    })
    .finally(() => {
      inflight = null;
    });
}

/** Прочитанное заранее начало галереи, если оно есть. */
export function getGallerySnapshot(): GallerySnapshot | null {
  return snapshot;
}

/**
 * Шит прочитал галерею целиком — следующее открытие начнётся с неё. Она
 * могла измениться с тех пор, но шит при каждом открытии читает её заново и
 * поправит список сам.
 */
export function setGallerySnapshot(next: GallerySnapshot): void {
  snapshot = next;
}

/** Только для тестов. */
export function resetGallerySnapshot(): void {
  snapshot = null;
}
