import * as ImagePicker from 'expo-image-picker';

import { MediaLimits } from './constants';
import { compressImage } from './lib/compressImage';
import { mimeFromUri } from './lib/mime';
import type { LocalMedia } from './types';

export type PickMediaOptions = {
  /** Defaults to both. */
  mediaTypes?: ('images' | 'videos')[];
  allowsMultipleSelection?: boolean;
};

/**
 * `null` means the user dismissed the picker; an empty array never happens.
 * Callers distinguish "changed their mind" from "nothing to send".
 */
export type PickMediaResult = LocalMedia[] | null;

function toLocalMedia(asset: ImagePicker.ImagePickerAsset): LocalMedia {
  const isVideo = asset.type === 'video';
  const fallbackMime = isVideo ? 'video/mp4' : 'image/jpeg';

  return {
    kind: isVideo ? 'video' : 'photo',
    uri: asset.uri,
    // The gallery does not always report a MIME type, so the extension is the
    // fallback before the hardcoded default.
    mimeType: asset.mimeType ?? mimeFromUri(asset.uri, fallbackMime),
    width: asset.width || null,
    height: asset.height || null,
    durationMs: asset.duration ?? null,
  };
}

/**
 * Photos are compressed here rather than at upload time so that every path
 * into the feature — gallery, camera — produces media the caller can send
 * as-is. Videos are passed through: re-encoding video on the device is slow
 * and expo does not offer it, so that saving belongs on the server.
 */
async function normalize(assets: ImagePicker.ImagePickerAsset[]): Promise<LocalMedia[]> {
  return Promise.all(
    assets.map(async (asset) => {
      const media = toLocalMedia(asset);

      return media.kind === 'photo' ? compressImage(media) : media;
    }),
  );
}

/** Opens the system gallery. Returns `null` if the user cancelled. */
export async function pickMediaFromLibrary(
  options: PickMediaOptions = {},
): Promise<PickMediaResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: options.mediaTypes ?? ['images', 'videos'],
    allowsMultipleSelection: options.allowsMultipleSelection ?? false,
    selectionLimit: MediaLimits.gallery.maxSelection,
    videoMaxDuration: MediaLimits.video.maxDurationMs / 1000,
    // Full quality out of the picker; the resize below is what saves traffic,
    // and compressing twice only loses detail.
    quality: 1,
  });

  if (result.canceled) {
    return null;
  }

  return normalize(result.assets);
}

/**
 * The system camera. `CameraCapture` is the in-app alternative — use this one
 * when the platform camera UI is enough and there is nothing to overlay.
 */
export async function captureMediaWithSystemCamera(
  options: Pick<PickMediaOptions, 'mediaTypes'> = {},
): Promise<PickMediaResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();

  if (!permission.granted) {
    return null;
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: options.mediaTypes ?? ['images'],
    videoMaxDuration: MediaLimits.video.maxDurationMs / 1000,
    quality: 1,
  });

  if (result.canceled) {
    return null;
  }

  return normalize(result.assets);
}
