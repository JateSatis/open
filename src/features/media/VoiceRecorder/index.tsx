import { useEffect } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { MediaLimits } from '@/features/media/constants';
import { formatDuration } from '@/features/media/lib/formatDuration';
import type { LocalMedia } from '@/features/media/types';
import { useVoiceRecorder } from '@/features/media/useVoiceRecorder';
import { useTheme } from '@/hooks/use-theme';

export type VoiceRecorderProps = {
  /** Called with the finished recording. Not called for a discarded tap. */
  onRecorded: (media: LocalMedia) => void;
  /** Called when the user cancels, or when the microphone is refused. */
  onCancel?: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Tap to start, tap to send. Deliberately not hold-to-talk: the gesture belongs
 * to whatever input bar embeds this, and both gestures drive the same hook.
 */
export function VoiceRecorder({ onRecorded, onCancel, style }: VoiceRecorderProps) {
  const theme = useTheme();
  const { status, durationMs, level, start, stop, cancel } = useVoiceRecorder();

  const isRecording = status === 'recording';

  const finish = async () => {
    const media = await stop();

    if (media) {
      onRecorded(media);
    } else {
      // Too short to be a message, so there is nothing to send and the caller
      // should close the recorder rather than wait.
      onCancel?.();
    }
  };

  const discard = async () => {
    await cancel();
    onCancel?.();
  };

  // The maximum length is a product limit, so it is enforced here rather than
  // in the hook: at the cap the recording is sent, not thrown away.
  useEffect(() => {
    if (isRecording && durationMs >= MediaLimits.voice.maxDurationMs) {
      void finish();
    }
    // `finish` closes over `stop`, which is stable for the life of the recorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, durationMs]);

  if (status === 'denied') {
    return (
      <View style={[styles.container, style]}>
        <Text variant="small" color="danger">
          Microphone access is off. Turn it on in system settings to record voice messages.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {isRecording ? (
        <>
          <Button label="Cancel" variant="ghost" size="sm" onPress={discard} />
          <View style={styles.body}>
            <View style={[styles.levelTrack, { backgroundColor: theme.backgroundSelected }]}>
              <View
                testID="voice-recorder-level"
                style={[
                  styles.level,
                  { backgroundColor: theme.danger, width: `${(level ?? 0) * 100}%` },
                ]}
              />
            </View>
            <Text variant="caption" color="textSecondary">
              {formatDuration(durationMs)}
            </Text>
          </View>
          <Button label="Send" size="sm" onPress={finish} />
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Record voice message"
          onPress={start}
          style={[styles.recordButton, { backgroundColor: theme.danger }]}>
          <Text variant="bodyBold" style={{ color: theme.primaryText }}>
            ●
          </Text>
        </Pressable>
      )}
    </View>
  );
}
