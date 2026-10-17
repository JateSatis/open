import { useCallback, useState } from 'react';

import {
  libraryAssetToLocalMedia,
  MediaLimits,
  readVideoFrame,
  resolveLibraryAsset,
  type GalleryFilter,
  type LocalMedia,
  type MediaLibraryItem,
  type VideoFrame,
} from '@/features/media';

/** Видео, принятое для попа: файл на устройстве и его первый кадр. */
export type PickedPopVideo = {
  media: LocalMedia & { width: number; height: number };
  frame: VideoFrame;
};

export const NOT_VERTICAL = 'Попсы — только вертикальные видео';
const TOO_LONG = 'Поп — не длиннее 90 секунд';
const NO_DURATION = 'Не удалось узнать длительность видео. Выберите другое.';
const UNREADABLE = 'Не удалось открыть видео. Выберите другое.';

/**
 * Что шит показывает: только видео до 90 секунд. Видео без длительности
 * остаются: выбор его не примет и скажет почему. Ориентацию по плитке не
 * узнать: размеры в медиатеке бывают пустыми и не учитывают поворот.
 */
export const POP_VIDEO_FILTER: GalleryFilter = {
  kind: 'video',
  maxDurationMs: MediaLimits.pop.maxDurationMs,
};

/**
 * Выбор видео для попа. Ориентацию честно говорит только кадр: горизонтальное
 * или квадратное видео не принимается, и человек видит почему.
 */
export function usePopVideoPick() {
  const [video, setVideo] = useState<PickedPopVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const onPick = useCallback(
    (asset: MediaLibraryItem) => {
      setChecking(true);
      setError(null);

      void (async () => {
        try {
          const resolved = await resolveLibraryAsset(asset);
          const frame = await readVideoFrame(resolved.uri);
          const media = libraryAssetToLocalMedia(resolved);

          if (frame.height <= frame.width) {
            setError(NOT_VERTICAL);
            return;
          }

          // Без длительности не проверить 90 секунд, а база поп без неё не примет.
          if (!media.durationMs) {
            setError(NO_DURATION);
            return;
          }

          if (media.durationMs > MediaLimits.pop.maxDurationMs) {
            setError(TOO_LONG);
            return;
          }

          const picked = { media: { ...media, width: frame.width, height: frame.height }, frame };

          setVideo(picked);
        } catch {
          setError(UNREADABLE);
        } finally {
          setChecking(false);
        }
      })();
    },
    [],
  );

  return { video, error, checking, onPick };
}
