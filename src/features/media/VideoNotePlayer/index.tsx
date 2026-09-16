import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatDuration } from '@/features/media/lib/formatDuration';

export type VideoNotePlayerProps = {
  /** Public URL from `attachments.url`, or a local `file://` URI before send. */
  uri: string;
  /** From `attachments.duration_ms`. */
  durationMs: number | null;
  /** Diameter of the circle in points. */
  size?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * The circular shape is applied here, not baked into the file: the recording
 * is a normal rectangular video, so `contentFit="cover"` fills the circle and
 * the sides are clipped rather than letterboxed.
 */
export function VideoNotePlayer({ uri, durationMs, size = 240, style }: VideoNotePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);

  const player = useVideoPlayer(uri, (instance) => {
    // A video note is short and read like a message, so it repeats until the
    // viewer stops it, the way Telegram plays them.
    instance.loop = true;
  });

  const togglePlayback = () => {
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
      return;
    }

    player.play();
    setIsPlaying(true);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? 'Pause video message' : 'Play video message'}
      onPress={togglePlayback}
      style={[styles.circle, { width: size, height: size }, style]}>
      <VideoView
        player={player}
        testID="video-note-view"
        contentFit="cover"
        nativeControls={false}
        style={styles.video}
      />
      {!isPlaying && durationMs !== null ? (
        <View style={styles.duration}>
          <Text variant="caption" color="textInverse">
            {formatDuration(durationMs)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
