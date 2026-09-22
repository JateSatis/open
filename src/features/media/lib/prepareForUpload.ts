import { compressImage } from './compressImage';
import { compressVideo } from './compressVideo';

import type { LocalMedia } from '@/features/media/types';

/**
 * Единственная точка входа для сжатия перед отправкой — вызывающему коду
 * (композеру чата) не нужно знать, что фото и видео сжимаются по-разному.
 */
export async function prepareForUpload(media: LocalMedia): Promise<LocalMedia> {
  return media.kind === 'photo' ? compressImage(media) : compressVideo(media);
}
