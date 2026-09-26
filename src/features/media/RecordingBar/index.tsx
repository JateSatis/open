import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Extrapolation,
} from 'react-native-reanimated';

import { LIVE_BAR_WIDTH, LIVE_HEIGHT, styles } from './styles';

import { Text } from '@/components/Text';
import { formatDuration } from '@/features/media/lib/formatDuration';
import type { RecordDrag } from '@/features/media/RecordButton';
import { CANCEL_DISTANCE } from '@/features/media/RecordButton/styles';
import type { HoldToRecord } from '@/features/media/useHoldToRecord';
import { useTheme } from '@/hooks/use-theme';

export const CANCEL_HINT = '‹ Влево — отмена';

/** Как часто мигает точка записи. */
const BLINK_MS = 600;

/** `0:03,4` — десятые видны, пока запись короткая: так понятно, что она идёт. */
export function formatRecordingTime(durationMs: number): string {
  const tenths = Math.floor((durationMs % 1000) / 100);

  return `${formatDuration(durationMs)},${tenths}`;
}

export type RecordingBarProps = {
  hold: HoldToRecord;
  drag: RecordDrag;
};

/**
 * Полоса вместо поля ввода, пока идёт запись. Лежит поверх поля, а не
 * вместо него: поле остаётся смонтированным, и открытая клавиатура не
 * прыгает, пока человек говорит.
 */
export function RecordingBar({ hold, drag }: RecordingBarProps) {
  const theme = useTheme();
  const locked = hold.phase === 'locked';
  const blink = useSharedValue(1);

  useEffect(() => {
    blink.value = withRepeat(withTiming(0.2, { duration: BLINK_MS }), -1, true);

    return () => cancelAnimation(blink);
  }, [blink]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  // Подсказка едет за пальцем и тускнеет к порогу отмены.
  const hintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-drag.x.value, [0, CANCEL_DISTANCE], [1, 0.1], Extrapolation.CLAMP),
    transform: [{ translateX: drag.x.value }],
  }));

  return (
    <View testID="recording-bar" style={[styles.bar, { backgroundColor: theme.background }]}>
      <Animated.View style={[styles.dot, { backgroundColor: theme.danger }, dotStyle]} />

      <Text variant="small" style={styles.timer} accessibilityLabel="Длительность записи">
        {formatRecordingTime(hold.durationMs)}
      </Text>

      <View style={styles.live}>
        {hold.recentLevels.map((level, index) => (
          <View
            // Окно сдвигается, и позиция здесь и есть идентичность столбика.
            key={index}
            style={[
              styles.liveBar,
              {
                height: Math.max(LIVE_BAR_WIDTH, level * LIVE_HEIGHT),
                backgroundColor: theme.danger,
              },
            ]}
          />
        ))}
      </View>

      {locked ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Отменить запись"
          onPress={hold.cancelLocked}
          style={styles.hint}
        >
          <Text variant="smallBold" color="danger">
            Отмена
          </Text>
        </Pressable>
      ) : (
        // Подсказка едет влево внутри своей области и не наезжает на уровни.
        <View style={styles.hintClip}>
          <Animated.View style={hintStyle}>
            <Text variant="small" color="textSecondary">
              {CANCEL_HINT}
            </Text>
          </Animated.View>
        </View>
      )}
    </View>
  );
}
