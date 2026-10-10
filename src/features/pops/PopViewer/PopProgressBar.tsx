import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatDuration } from '@/features/media/lib/formatDuration';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

/**
 * Перемотка, пока тянут, — когда палец ушёл хотя бы на эту долю полосы:
 * плееру не нужен seek на каждый кадр. Отпустили — точная перемотка.
 */
const SEEK_STEP = 0.01;

export type PopProgressBarProps = {
  width: number;
  durationMs: number;
  progress: SharedValue<number>;
  scrubbing: SharedValue<boolean>;
  onSeek: (share: number) => void;
  onScrubChange: (active: boolean) => void;
};

function clampShare(x: number, width: number): number {
  'worklet';
  return Math.min(1, Math.max(0, x / width));
}

/**
 * Тонкая полоса у нижнего края. Её тянут: она утолщается, над ней — «0:12 /
 * 0:45», видео перематывается. Жест захватывает касание сразу, поэтому
 * листание попсов из полосы не начинается.
 */
export function PopProgressBar({
  width,
  durationMs,
  progress,
  scrubbing,
  onSeek,
  onScrubChange,
}: PopProgressBarProps) {
  const theme = useTheme();
  const [label, setLabel] = useState<string | null>(null);
  const lastSeek = useSharedValue(-1);

  const showTime = useCallback(
    (share: number) =>
      setLabel(`${formatDuration(share * durationMs)} / ${formatDuration(durationMs)}`),
    [durationMs],
  );

  const release = useCallback(
    (share: number) => {
      onSeek(share);
      onScrubChange(false);
      setLabel(null);
    },
    [onScrubChange, onSeek],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((event) => {
          const share = clampShare(event.x, width);

          scrubbing.set(true);
          progress.set(share);
          runOnJS(onScrubChange)(true);
          runOnJS(showTime)(share);
        })
        .onUpdate((event) => {
          const share = clampShare(event.x, width);

          progress.set(share);
          runOnJS(showTime)(share);

          if (Math.abs(share - lastSeek.get()) >= SEEK_STEP) {
            lastSeek.set(share);
            runOnJS(onSeek)(share);
          }
        })
        .onFinalize(() => {
          scrubbing.set(false);
          runOnJS(release)(progress.get());
        }),
    [lastSeek, onScrubChange, onSeek, progress, release, scrubbing, showTime, width],
  );

  const fill = useAnimatedStyle(() => ({ width: progress.get() * width }));
  const track = useAnimatedStyle(() => ({
    height: scrubbing.get() ? Sizes.popProgressActive : Sizes.popProgress,
  }));

  return (
    <View style={styles.progressArea} pointerEvents="box-none">
      {label ? (
        <View style={styles.progressLabel} pointerEvents="none">
          <Text
            testID="pop-progress-time"
            variant="subtitle"
            color="textOnMedia"
            style={styles.onMediaText}
          >
            {label}
          </Text>
        </View>
      ) : null}
      <GestureDetector gesture={pan}>
        <View
          testID="pop-progress"
          accessibilityRole="adjustable"
          accessibilityLabel="Перемотка"
          style={styles.progressTouch}
        >
          <Animated.View
            style={[styles.progressTrack, { backgroundColor: theme.textOnMediaSecondary }, track]}
          >
            <Animated.View
              style={[styles.progressFill, { backgroundColor: theme.textOnMedia }, fill]}
            />
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}
