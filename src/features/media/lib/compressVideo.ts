import { Video as VideoCompressor } from 'react-native-compressor';

import { MediaLimits } from '@/features/media/constants';
import type { LocalMedia } from '@/features/media/types';

/** Видео не удалось пережать — в чат оно не уходит. */
export class VideoPrepareError extends Error {
  constructor(readonly cause?: unknown) {
    super('Failed to compress video');
    this.name = 'VideoPrepareError';
  }
}

/**
 * Камера телефона снимает заметно тяжелее, чем нужно для чата, а видео в
 * Open ещё и публичное — платится один раз при загрузке и каждый раз при
 * просмотре. Разрешение и битрейт сжатия выбираются автоматически исходно
 * относительно битрейта самого файла (`compressionMethod: 'auto'`, тот же
 * режим, которым рекламирует себя библиотека как «как в WhatsApp»);
 * `maxDimensionPx` — единственный параметр, который переопределён здесь.
 *
 * Сжатие — условие отправки: пережатый файл собирается заново, без
 * геометки и данных камеры исходника. Если библиотека не справилась
 * (незнакомый кодек, битый файл), оригинал не уходит — `VideoPrepareError`.
 * Метаданные вычищает и сервер (`sanitize-media`), но отправлять исходник со
 * всем, что в нём записано, клиент не должен и сам.
 */
export async function compressVideo(media: LocalMedia): Promise<LocalMedia> {
  if (media.kind !== 'video') return media;

  try {
    const uri = await VideoCompressor.compress(media.uri, {
      compressionMethod: 'auto',
      maxSize: MediaLimits.video.maxDimensionPx,
    });

    return { ...media, uri, mimeType: 'video/mp4' };
  } catch (error) {
    throw new VideoPrepareError(error);
  }
}
