// Видео попа — в Storage: сжатие, обязательный постер, своя папка. Общая
// часть публикации из «Попсов» (`publishing.ts`) и поста с новым попом из
// «Постов» (доставка сообщений чата).

import type { PopMedia } from '@/api/pops';
import {
  prepareForUpload,
  uploadPopMedia,
  type LocalMedia,
  type UploadedMedia,
} from '@/features/media';

/** Без постера база поп не примет: сбой понятен заранее, до загрузки. */
export class PopPosterError extends Error {
  constructor() {
    super('Не удалось снять обложку видео');
    this.name = 'PopPosterError';
  }
}

/** Сжатие, постер и загрузка видео попа. Общая часть публикации из «Попсов» и из «Постов». */
export async function uploadPop(media: LocalMedia, userId: string): Promise<UploadedMedia> {
  const prepared = await prepareForUpload(media);

  if (!prepared.posterUri) throw new PopPosterError();

  return uploadPopMedia(prepared, userId);
}

/** Загруженное видео — в форме, которую принимает `publish_pop`. */
export function toPopMedia(uploaded: UploadedMedia, fallback: LocalMedia): PopMedia {
  return {
    url: uploaded.url,
    posterUrl: uploaded.posterUrl ?? '',
    mimeType: uploaded.mimeType,
    width: uploaded.width ?? fallback.width ?? 0,
    height: uploaded.height ?? fallback.height ?? 0,
    durationMs: uploaded.durationMs ?? fallback.durationMs ?? 0,
    sizeBytes: uploaded.sizeBytes,
  };
}
