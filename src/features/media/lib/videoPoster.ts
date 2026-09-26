import { getThumbnailAsync } from 'expo-video-thumbnails';

import { compressImage } from './compressImage';

import { MediaLimits } from '@/features/media/constants';
import type { LocalMedia } from '@/features/media/types';

/**
 * Снимает первый кадр уже сжатого видео — постер для плитки в чате и для
 * ленты. Без него видео в чужой переписке рисуется пустым прямоугольником:
 * кадр из mp4 по ссылке картинкой не достать.
 *
 * Заодно отсюда берутся размеры видео. Кадр уже повёрнут так, как видео
 * показывается, и снят со сжатого файла, тогда как метаданные галереи на
 * Android у портретного видео бывают с перепутанными шириной и высотой, а
 * размеры в них — исходника, а не того, что уйдёт в чат.
 *
 * Постер — не условие отправки: не снялся кадр — видео уходит без него.
 */
export async function withVideoPoster(media: LocalMedia): Promise<LocalMedia> {
  try {
    const frame = await getThumbnailAsync(media.uri, { time: 0, quality: 1 });
    const poster = await compressImage(
      {
        kind: 'photo',
        uri: frame.uri,
        mimeType: 'image/jpeg',
        width: frame.width,
        height: frame.height,
        durationMs: null,
      },
      MediaLimits.poster,
    );

    return { ...media, posterUri: poster.uri, width: frame.width, height: frame.height };
  } catch {
    return media;
  }
}
