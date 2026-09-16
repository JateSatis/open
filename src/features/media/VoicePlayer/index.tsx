import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatDuration } from '@/features/media/lib/formatDuration';
import { useTheme } from '@/hooks/use-theme';

export type VoicePlayerProps = {
  /** Public URL from `attachments.url`, or a local `file://` URI before send. */
  uri: string;
  /**
   * From `attachments.duration_ms`. Shown before the file is loaded so the
   * bubble does not resize once playback starts.
   */
  durationMs: number | null;
  style?: StyleProp<ViewStyle>;
};

export function VoicePlayer({ uri, durationMs, style }: VoicePlayerProps) {
  const theme = useTheme();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  // `status.duration` is 0 until the file is loaded, so the stored duration is
  // what keeps the label stable from the first frame.
  const totalMs = status.isLoaded && status.duration > 0 ? status.duration * 1000 : (durationMs ?? 0);
  const elapsedMs = status.currentTime * 1000;
  const progress = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0;

  const togglePlayback = () => {
    if (status.playing) {
      player.pause();
      return;
    }

    // Replaying after the end would otherwise resume from the finished
    // position and play nothing.
    if (status.didJustFinish || elapsedMs >= totalMs) {
      player.seekTo(0);
    }

    player.play();
  };

  return (
    <View style={[styles.container, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice message' : 'Play voice message'}
        accessibilityState={{ busy: status.isBuffering }}
        onPress={togglePlayback}
        style={[styles.button, { backgroundColor: theme.primary }]}>
        <Text variant="bodyBold" style={{ color: theme.primaryText }}>
          {status.playing ? '⏸' : '▶'}
        </Text>
      </Pressable>

      <View style={styles.body}>
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View
            testID="voice-player-progress"
            style={[
              styles.progress,
              { backgroundColor: theme.primary, width: `${progress * 100}%` },
            ]}
          />
        </View>
        <Text variant="caption" color="textSecondary">
          {formatDuration(status.playing || elapsedMs > 0 ? elapsedMs : totalMs)}
        </Text>
      </View>
    </View>
  );
}
