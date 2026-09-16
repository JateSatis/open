import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { MediaLimits } from '@/features/media/constants';
import { formatDuration } from '@/features/media/lib/formatDuration';
import type { LocalMedia } from '@/features/media/types';
import { useTheme } from '@/hooks/use-theme';

export type VideoNoteRecorderProps = {
  onRecorded: (media: LocalMedia) => void;
  onCancel?: () => void;
  /** Diameter of the circle in points. */
  size?: number;
  style?: StyleProp<ViewStyle>;
};

const TICK_MS = 200;
/** A 4:3 sensor frame, so the preview is a third taller than the circle. */
const PREVIEW_ASPECT = 4 / 3;

/**
 * Records a video message shown as a circle, the way Telegram does.
 *
 * The circle is a display convention, not a property of the file: there is no
 * on-device video cropping in Expo, so the recording stays rectangular and
 * `VideoNotePlayer` masks it the same way this preview does. The stored
 * `width`/`height` therefore describe the real file, not the circle.
 */
export function VideoNoteRecorder({
  onRecorded,
  onCancel,
  size = 240,
  style,
}: VideoNoteRecorderProps) {
  const theme = useTheme();
  const cameraRef = useRef<CameraView>(null);
  const [camera, requestCamera] = useCameraPermissions();
  const [microphone, requestMicrophone] = useMicrophonePermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  // Set when the user cancels, so the resolving `recordAsync` knows not to
  // hand the file to the caller.
  const discardedRef = useRef(false);
  // `recordAsync` does not report a duration, and the `elapsedMs` captured by
  // this closure is the value from before recording started.
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const timer = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), TICK_MS);

    return () => clearInterval(timer);
  }, [isRecording]);

  const start = async () => {
    const granted =
      (camera?.granted || (await requestCamera()).granted) &&
      (microphone?.granted || (await requestMicrophone()).granted);

    if (!granted) {
      return;
    }

    discardedRef.current = false;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setIsRecording(true);

    // Resolves when `stopRecording` is called or `maxDuration` is reached, so
    // the length limit is enforced by the camera itself.
    const recording = await cameraRef.current?.recordAsync({
      maxDuration: MediaLimits.videoNote.maxDurationMs / 1000,
    });

    const durationMs = Date.now() - startedAtRef.current;

    setIsRecording(false);

    if (!recording?.uri || discardedRef.current) {
      return;
    }

    onRecorded({
      kind: 'video_note',
      uri: recording.uri,
      mimeType: 'video/mp4',
      width: MediaLimits.videoNote.sizePx,
      height: MediaLimits.videoNote.sizePx,
      durationMs,
    });
  };

  const stop = () => cameraRef.current?.stopRecording();

  const discard = () => {
    discardedRef.current = true;
    stop();
    onCancel?.();
  };

  if (camera && !camera.granted && !camera.canAskAgain) {
    return (
      <View style={[styles.message, style]}>
        <Text variant="small" color="danger">
          Camera access is off. Turn it on in system settings to record video messages.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.circle, { width: size, height: size }]}>
        <CameraView
          ref={cameraRef}
          testID="video-note-preview"
          mode="video"
          facing="front"
          mirror
          videoQuality="480p"
          style={[styles.preview, { width: size, height: size * PREVIEW_ASPECT }]}
        />
      </View>

      <View style={styles.controls}>
        {isRecording ? (
          <>
            <Button label="Cancel" variant="ghost" size="sm" onPress={discard} />
            <Text variant="caption" color="textSecondary">
              {formatDuration(elapsedMs)}
            </Text>
            <Button label="Send" size="sm" onPress={stop} />
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Record video message"
            onPress={start}
            style={[styles.recordButton, { backgroundColor: theme.danger }]}>
            <Text variant="bodyBold" style={{ color: theme.primaryText }}>
              ●
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
