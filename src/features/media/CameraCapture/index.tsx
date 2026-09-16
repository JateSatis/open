import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { MediaLimits } from '@/features/media/constants';
import { compressImage } from '@/features/media/lib/compressImage';
import type { LocalMedia } from '@/features/media/types';
import { useTheme } from '@/hooks/use-theme';

export type CameraCaptureProps = {
  /** Photos arrive already resized and re-encoded; videos are untouched. */
  onCaptured: (media: LocalMedia) => void;
  onCancel?: () => void;
  /** Which modes the shutter offers. Defaults to both. */
  modes?: ('photo' | 'video')[];
  style?: StyleProp<ViewStyle>;
};

/**
 * In-app camera, as opposed to `captureMediaWithSystemCamera`: use this one
 * when the capture screen needs to belong to the app.
 */
export function CameraCapture({ onCaptured, onCancel, modes, style }: CameraCaptureProps) {
  const theme = useTheme();
  const cameraRef = useRef<CameraView>(null);
  const availableModes = modes ?? ['photo', 'video'];
  const [camera, requestCamera] = useCameraPermissions();
  const [, requestMicrophone] = useMicrophonePermissions();
  const [mode, setMode] = useState<'photo' | 'video'>(availableModes[0]);
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [isRecording, setIsRecording] = useState(false);

  const takePhoto = async () => {
    // Full quality out of the sensor; the resize below is what saves the bytes.
    const picture = await cameraRef.current?.takePictureAsync({ quality: 1 });

    if (!picture) {
      return;
    }

    onCaptured(
      await compressImage({
        kind: 'photo',
        uri: picture.uri,
        mimeType: picture.format === 'png' ? 'image/png' : 'image/jpeg',
        width: picture.width,
        height: picture.height,
        durationMs: null,
      }),
    );
  };

  const recordVideo = async () => {
    if (!(await requestMicrophone()).granted) {
      return;
    }

    const startedAt = Date.now();

    setIsRecording(true);

    const recording = await cameraRef.current?.recordAsync({
      maxDuration: MediaLimits.video.maxDurationMs / 1000,
    });

    setIsRecording(false);

    if (!recording?.uri) {
      return;
    }

    onCaptured({
      kind: 'video',
      uri: recording.uri,
      mimeType: 'video/mp4',
      width: null,
      height: null,
      durationMs: Date.now() - startedAt,
    });
  };

  const onShutterPress = () => {
    if (mode === 'photo') {
      return takePhoto();
    }

    if (isRecording) {
      cameraRef.current?.stopRecording();
      return undefined;
    }

    return recordVideo();
  };

  if (!camera?.granted) {
    return (
      <View style={[styles.message, style]}>
        <Text variant="small" color="textSecondary">
          {camera && !camera.canAskAgain
            ? 'Camera access is off. Turn it on in system settings to take photos and videos.'
            : 'Open needs the camera to take photos and videos.'}
        </Text>
        {camera?.canAskAgain !== false ? (
          <Button label="Allow camera" onPress={requestCamera} />
        ) : null}
        {onCancel ? <Button label="Cancel" variant="ghost" onPress={onCancel} /> : null}
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <CameraView
        ref={cameraRef}
        testID="camera-capture-preview"
        mode={mode === 'photo' ? 'picture' : 'video'}
        facing={facing}
        style={styles.preview}
      />

      <View style={styles.controls}>
        <Button
          label={facing === 'back' ? 'Front' : 'Back'}
          variant="ghost"
          size="sm"
          disabled={isRecording}
          onPress={() => setFacing(facing === 'back' ? 'front' : 'back')}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            mode === 'photo' ? 'Take photo' : isRecording ? 'Stop recording' : 'Record video'
          }
          onPress={onShutterPress}
          style={[
            styles.shutter,
            { borderColor: theme.border, backgroundColor: isRecording ? theme.danger : theme.text },
          ]}
        />

        {availableModes.length > 1 ? (
          <Button
            label={mode === 'photo' ? 'Video' : 'Photo'}
            variant="ghost"
            size="sm"
            disabled={isRecording}
            onPress={() => setMode(mode === 'photo' ? 'video' : 'photo')}
          />
        ) : (
          <View />
        )}
      </View>
    </View>
  );
}
