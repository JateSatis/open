import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

import type { MediaViewerItem } from './types';

export type MediaViewerPageProps = {
  item: MediaViewerItem;
  width: number;
  height: number;
  /** Только активная страница играет — соседи по свайпу должны молчать. */
  isActive: boolean;
  /**
   * Пауза по тапу. Тап ловит общий жест просмотрщика (он отличает его от
   * двойного), а страница отдаёт ему свой переключатель. `null` — снят.
   */
  onToggleReady: (toggle: (() => void) | null) => void;
};

function PhotoPage({ item, width, height }: { item: MediaViewerItem; width: number; height: number }) {
  return (
    <Image
      source={{ uri: item.url }}
      style={{ width, height }}
      contentFit="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

function VideoPage({ item, width, height, isActive, onToggleReady }: MediaViewerPageProps) {
  // Подпись не обязана отслеживать автопаузу при уходе со страницы свайпом —
  // пока страница не активна, её всё равно не видно; отражать реальное
  // состояние она начинает заново с момента, когда человек сам тапает.
  const [isPlaying, setIsPlaying] = useState(isActive);
  const player = useVideoPlayer(item.url, (instance) => {
    instance.loop = true;
  });

  useEffect(() => {
    if (isActive) {
      player.play();
    } else {
      player.pause();
    }
  }, [isActive, player]);

  const toggle = useCallback(() => {
    if (player.playing) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play();
      setIsPlaying(true);
    }
  }, [player]);

  useEffect(() => {
    onToggleReady(toggle);

    return () => onToggleReady(null);
  }, [onToggleReady, toggle]);

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? 'Поставить видео на паузу' : 'Воспроизвести видео'}
      onAccessibilityTap={toggle}
      style={{ width, height }}
    >
      {/* TextureView: увеличение и сдвиг — трансформации, а SurfaceView их не
          принимает. */}
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
        surfaceType="textureView"
      />
    </View>
  );
}

export function MediaViewerPage(props: MediaViewerPageProps) {
  return (
    <View style={{ width: props.width, height: props.height }}>
      {props.item.kind === 'video' ? <VideoPage {...props} /> : <PhotoPage {...props} />}
    </View>
  );
}
