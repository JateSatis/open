import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { resolveAssetUri, type MediaLibraryItem } from '@/features/media/mediaLibrary';

export type PreviewVideoProps = {
  asset: MediaLibraryItem;
  isActive: boolean;
};

/**
 * Видео в предпросмотре: без звука, по кругу, играет только активная
 * страница. Пока путь к файлу добирается и первый кадр не готов, под видео
 * видно превью из сетки.
 */
export function PreviewVideo({ asset, isActive }: PreviewVideoProps) {
  const [uri, setUri] = useState<string | null>(null);
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = true;
  });

  useEffect(() => {
    if (!isActive || uri) return;

    let cancelled = false;

    void resolveAssetUri(asset.id)
      .then((resolved) => {
        if (!cancelled) setUri(resolved);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [asset.id, isActive, uri]);

  useEffect(() => {
    if (!uri) return;

    if (isActive) player.play();
    else player.pause();
  }, [isActive, player, uri]);

  if (!uri) return null;

  return (
    <VideoView
      testID="media-preview-video"
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
      surfaceType="textureView"
    />
  );
}
