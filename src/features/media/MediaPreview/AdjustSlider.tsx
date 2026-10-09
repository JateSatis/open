// Ползунок на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться.
/* eslint-disable react-hooks/immutability */
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { ADJUST_MAX, ADJUST_MIN } from '@/features/media/photoEdits/colorMatrix';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

/** Ближе этого к нулю ползунок прилипает к нулю — попасть пальцем в ноль легко. */
const ZERO_SNAP = 3;

export type AdjustSliderProps = {
  testID: string;
  label: string;
  value: SharedValue<number>;
};

function formatValue(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function haptic() {
  void Haptics.selectionAsync();
}

/**
 * Ползунок настройки цвета: ноль посередине, от −100 до 100. Пока палец его
 * тянет, вместо названия видно значение акцентным цветом. Проход через ноль
 * отмечается лёгкой вибрацией. Значение живёт в shared value — фото
 * меняется на UI-потоке, без перерисовки React на каждом кадре; сам ряд
 * перерисовывается только ради числа в подписи.
 */
export function AdjustSlider({ testID, label, value }: AdjustSliderProps) {
  const theme = useTheme();
  const width = useSharedValue(0);
  const start = useSharedValue(0);
  const [shown, setShown] = useState<number | null>(null);
  // Значение для чтения с экрана — то, что видно на отпущенном ползунке.
  const [settled, setSettled] = useState(() => Math.round(value.value));

  useAnimatedReaction(
    () => Math.round(value.value),
    (now, before) => {
      if (now !== before) runOnJS(setSettled)(now);
    },
  );

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      start.value = value.value;
      runOnJS(setShown)(Math.round(value.value));
    })
    .onUpdate((event) => {
      if (width.value <= 0) return;

      const raw = start.value + (event.translationX / width.value) * (ADJUST_MAX - ADJUST_MIN);
      const clamped = Math.min(ADJUST_MAX, Math.max(ADJUST_MIN, raw));
      const next = Math.abs(clamped) < ZERO_SNAP ? 0 : Math.round(clamped);
      const previous = value.value;

      if (next === previous) return;

      // Отсечка на нуле: пришли в ноль или перескочили через него.
      if ((next === 0 && previous !== 0) || next * previous < 0) runOnJS(haptic)();

      value.value = next;
      runOnJS(setShown)(next);
    })
    .onFinalize(() => {
      runOnJS(setShown)(null);
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          ((value.value - ADJUST_MIN) / (ADJUST_MAX - ADJUST_MIN)) * width.value -
          Sizes.previewSliderThumb / 2,
      },
    ],
  }));

  const fillStyle = useAnimatedStyle(() => {
    const center = width.value / 2;
    const offset = (value.value / (ADJUST_MAX - ADJUST_MIN)) * width.value;

    return { left: Math.min(center, center + offset), width: Math.abs(offset) };
  });

  return (
    <View style={styles.sliderRow}>
      <Text
        variant="small"
        color={shown === null ? 'textOnMedia' : 'primary'}
        style={styles.sliderLabel}
        numberOfLines={1}
      >
        {shown === null ? label : formatValue(shown)}
      </Text>

      <GestureDetector gesture={pan}>
        <View
          testID={testID}
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ min: ADJUST_MIN, max: ADJUST_MAX, now: settled }}
          style={styles.sliderTrack}
          onLayout={(event) => {
            width.value = event.nativeEvent.layout.width;
          }}
        >
          <View style={[styles.sliderLine, { backgroundColor: theme.mediaControl }]} />
          <View
            style={[
              styles.sliderZero,
              { left: '50%', backgroundColor: theme.textOnMediaSecondary },
            ]}
          />
          <Animated.View
            style={[styles.sliderFill, { backgroundColor: theme.primary }, fillStyle]}
          />
          <Animated.View
            style={[styles.sliderThumb, { backgroundColor: theme.textOnMedia }, thumbStyle]}
          />
        </View>
      </GestureDetector>
    </View>
  );
}
