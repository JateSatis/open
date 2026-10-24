import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';
import { useCallback, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Sizes, Spacing } from '@/theme';

const RETURN_MS = 180;
const LEAVE_MS = 180;
const ICON_START_SCALE = 0.6;

/**
 * Убрать строку свайпом влево, как в почте: строка едет за пальцем, справа
 * из-под неё проявляется значок удаления; за порогом — лёгкая вибрация,
 * отпустил за порогом — строка уезжает за край, и только потом её убирают
 * (схлопывание — анимацией списка). Не дотянул — возвращается.
 *
 * Как `useSwipeReply`: только влево, вертикальный сдвиг гасит жест, а
 * перемотка голосового в раскрытой строке включается раньше и забирает
 * касание (`HorizontalGestureScope` вокруг пузыря).
 */
export function useSwipeRemove(id: string, onRemove: () => void) {
  const { width } = useWindowDimensions();
  const offset = useSharedValue(0);
  const armed = useSharedValue(false);
  const leaving = useSharedValue(false);

  const buzz = useCallback(() => {
    impactAsync(ImpactFeedbackStyle.Light).catch(() => undefined);
  }, []);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .withTestId(`watch-later-swipe-${id}`)
        .activeOffsetX(-Sizes.swipeReplyActivation)
        .failOffsetY([-Spacing.three, Spacing.three])
        .onUpdate((event) => {
          const shift = Math.min(0, event.translationX);
          const reached = -shift >= Sizes.swipeRemoveThreshold;

          if (reached !== armed.get()) {
            armed.set(reached);

            if (reached) runOnJS(buzz)();
          }

          offset.set(shift);
        })
        .onEnd(() => {
          if (!armed.get()) return;

          leaving.set(true);
          offset.set(
            withTiming(-width, { duration: LEAVE_MS }, (finished) => {
              if (finished) runOnJS(onRemove)();
            }),
          );
        })
        .onFinalize(() => {
          armed.set(false);

          if (!leaving.get()) offset.set(withTiming(0, { duration: RETURN_MS }));
        }),
    [armed, buzz, id, leaving, offset, onRemove, width],
  );

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() }],
  }));

  const iconStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      -offset.get(),
      [0, Sizes.swipeRemoveThreshold],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return {
      opacity: progress,
      transform: [{ scale: ICON_START_SCALE + progress * (1 - ICON_START_SCALE) }],
    };
  });

  return { gesture, contentStyle, iconStyle };
}
