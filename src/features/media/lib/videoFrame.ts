import { getThumbnailAsync } from 'expo-video-thumbnails';

export type VideoFrame = {
  /** Кадр — `file://` JPEG. */
  uri: string;
  width: number;
  height: number;
};

/**
 * Первый кадр видео, повёрнутый так, как видео показывается. Размеры из
 * медиатеки бывают пустыми и не учитывают поворот — ориентацию видео честно
 * говорит только кадр.
 */
export async function readVideoFrame(uri: string): Promise<VideoFrame> {
  const frame = await getThumbnailAsync(uri, { time: 0, quality: 0.7 });

  return { uri: frame.uri, width: frame.width, height: frame.height };
}
