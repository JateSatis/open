import { compressImage } from './compressImage';
import { compressVideo } from './compressVideo';
import { withVideoPoster } from './videoPoster';

import type { LocalMedia } from '@/features/media/types';

/**
 * Единственная точка входа для сжатия перед отправкой — вызывающему коду
 * (композеру чата) не нужно знать, что фото и видео сжимаются по-разному.
 */
export async function prepareForUpload(media: LocalMedia): Promise<LocalMedia> {
  if (media.kind === 'photo') return compressImage(media);

  const compressed = await compressVideo(media);

  return compressed.kind === 'video' ? withVideoPoster(compressed) : compressed;
}
