import { useVideoPlayer, VideoView } from 'expo-video';

import { styles } from './styles';

/** Выбранное видео по кругу и без звука — как превью в редакторе TikTok. */
export function PopVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  return (
    <VideoView
      testID="pop-editor-preview"
      player={player}
      style={styles.preview}
      contentFit="contain"
      nativeControls={false}
      // TextureView: SurfaceView на части устройств остаётся чёрным под другими слоями.
      surfaceType="textureView"
    />
  );
}
