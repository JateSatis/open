import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { MediaLimits } from '@/features/media/constants';
import type { LocalMedia } from '@/features/media/types';

/**
 * A camera photo is routinely 4000px and several megabytes, and in Open every
 * photo is public — it is paid for once on upload and again on every view in
 * the feed. Resizing and re-encoding before the upload is the cheapest
 * traffic saving available on the client.
 */
export async function compressImage(
  media: LocalMedia,
  limits: { maxWidthPx: number; quality: number } = MediaLimits.photo,
): Promise<LocalMedia> {
  const { maxWidthPx, quality } = limits;

  // Upscaling a small photo would cost bytes instead of saving them.
  const needsResize = media.width !== null && media.width > maxWidthPx;

  const context = ImageManipulator.manipulate(media.uri);

  if (needsResize) {
    // Height is left null so the aspect ratio is preserved.
    context.resize({ width: maxWidthPx, height: null });
  }

  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG });

  return {
    ...media,
    uri: result.uri,
    mimeType: 'image/jpeg',
    width: result.width,
    height: result.height,
  };
}
