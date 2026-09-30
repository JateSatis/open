import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { LOCK_DISTANCE, styles } from './styles';
import { useRecordGesture, type RecordGestureAction } from './useRecordGesture';

import { Text } from '@/components/Text';
import type { HoldToRecord } from '@/features/media/useHoldToRecord';
import { useTheme } from '@/hooks/use-theme';

/**
 * Где палец относительно точки касания, на UI-потоке: за ним едут круг под
 * пальцем, подсказка отмены и замок — кадр в кадр, без круга через JS.
 */
export type RecordDrag = {
  x: SharedValue<number>;
  y: SharedValue<number>;
};

export function useRecordDrag(): RecordDrag {
  return { x: useSharedValue(0), y: useSharedValue(0) };
}

export type RecordButtonProps = {
  hold: HoldToRecord;
  drag: RecordDrag;
  /** Записывать сейчас нельзя — например, в правке, где уже есть текст. */
  disabled?: boolean;
};

/**
 * Кнопка записи «Г». Буква вместо иконки намеренно, как «M»: набор иконок
 * ещё не выбран. Сам жест — в `useRecordGesture`.
 */
export function RecordButton({ hold, drag, disabled = false }: RecordButtonProps) {
  const theme = useTheme();
  const active = hold.phase !== 'idle';
  const locked = hold.phase === 'locked';
  const lockedShared = useSharedValue(false);
  const grow = useSharedValue(0);

  useEffect(() => {
    lockedShared.value = locked;
  }, [locked, lockedShared]);

  useEffect(() => {
    grow.value = withTiming(active ? 1 : 0, { duration: 160 });
  }, [active, grow]);

  // Жест собирается один раз, а действия берутся по ссылке: иначе каждая
  // перерисовка во время записи (десять в секунду) пересоздавала бы его.
  const holdRef = useRef(hold);

  useEffect(() => {
    holdRef.current = hold;
  }, [hold]);

  const dispatch = useCallback((action: RecordGestureAction) => holdRef.current[action](), []);

  const gesture = useRecordGesture({ drag, locked: lockedShared, onAction: dispatch });

  const circleStyle = useAnimatedStyle(() => ({
    opacity: grow.value,
    transform: [
      { translateX: lockedShared.value ? 0 : drag.x.value },
      { translateY: lockedShared.value ? 0 : drag.y.value },
      { scale: interpolate(grow.value, [0, 1], [0.4, 1]) },
    ],
  }));

  const lockStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, -drag.y.value / LOCK_DISTANCE);

    return {
      opacity: lockedShared.value ? 1 : grow.value * (1 - progress * 0.3),
      transform: [{ translateY: lockedShared.value ? 0 : drag.y.value * 0.4 }],
    };
  });

  if (disabled) {
    return (
      <View
        testID="record-voice-button"
        accessibilityRole="button"
        accessibilityLabel="Голосовое сообщение: удерживайте, чтобы записать"
        accessibilityState={{ disabled: true }}
        style={[styles.slot, styles.disabled]}
      >
        <View style={[styles.button, { backgroundColor: theme.backgroundElement }]}>
          <Text variant="bodyBold">Г</Text>
        </View>
      </View>
    );
  }

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID="record-voice-button"
        accessibilityRole="button"
        accessibilityLabel="Голосовое сообщение: удерживайте, чтобы записать"
        style={styles.slot}
      >
        <View
          style={[
            styles.button,
            { backgroundColor: theme.backgroundElement, opacity: active ? 0 : 1 },
          ]}
        >
          <Text variant="bodyBold">Г</Text>
        </View>

        {active ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.lock, { backgroundColor: theme.backgroundElement }, lockStyle]}
          >
            <Text variant="bodyBold" style={{ color: theme.text }}>
              {locked ? '🔒' : '🔓'}
            </Text>
            {locked ? null : (
              <Text variant="bodyBold" style={{ color: theme.textSecondary }}>
                ▲
              </Text>
            )}
          </Animated.View>
        ) : null}

        <Animated.View
          pointerEvents="none"
          style={[styles.circle, { backgroundColor: theme.primary }, circleStyle]}
        >
          <Text variant="bodyBold" style={{ color: theme.primaryText }}>
            {locked ? '➤' : 'Г'}
          </Text>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
