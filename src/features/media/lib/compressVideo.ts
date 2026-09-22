import { Video as VideoCompressor } from 'react-native-compressor';

import { MediaLimits } from '@/features/media/constants';
import type { LocalMedia } from '@/features/media/types';

/**
 * Камера телефона снимает заметно тяжелее, чем нужно для чата, а видео в
 * Open ещё и публичное — платится один раз при загрузке и каждый раз при
 * просмотре. Разрешение и битрейт сжатия выбираются автоматически исходно
 * относительно битрейта самого файла (`compressionMethod: 'auto'`, тот же
 * режим, которым рекламирует себя библиотека как «как в WhatsApp»);
 * `maxDimensionPx` — единственный параметр, который переопределён здесь.
 *
 * Сжатие — необязательное условие отправки: если библиотека не справилась
 * (незнакомый кодек, битый файл), в чат уходит оригинал, а не ошибка.
 */
export async function compressVideo(media: LocalMedia): Promise<LocalMedia> {
  if (media.kind !== 'video') return media;

  try {
    const uri = await VideoCompressor.compress(media.uri, {
      compressionMethod: 'auto',
      maxSize: MediaLimits.video.maxDimensionPx,
    });

    return { ...media, uri, mimeType: 'video/mp4' };
  } catch {
    return media;
  }
}
