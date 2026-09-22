import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { MediaViewerItem } from './types';

export type MediaViewerPageProps = {
  item: MediaViewerItem;
  width: number;
  height: number;
  /** Только активная страница играет — соседи по свайпу должны молчать. */
  isActive: boolean;
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

function VideoPage({ item, width, height, isActive }: MediaViewerPageProps) {
  // Подпись кнопки не обязана отслеживать автопаузу при уходе со страницы
  // свайпом — пока страница не активна, её всё равно не видно; отражать
  // реальное состояние она начинает заново с момента, когда пользователь
  // сам нажимает на видео.
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

  const toggle = () => {
    if (player.playing) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play();
      setIsPlaying(true);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? 'Поставить видео на паузу' : 'Воспроизвести видео'}
      onPress={toggle}
      style={{ width, height }}
    >
      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls={false} />
    </Pressable>
  );
}

export function MediaViewerPage(props: MediaViewerPageProps) {
  return (
    <View style={{ width: props.width, height: props.height }}>
      {props.item.kind === 'video' ? <VideoPage {...props} /> : <PhotoPage {...props} />}
    </View>
  );
}
