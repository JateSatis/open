import type { View } from 'react-native';
import {
  measure,
  runOnUI,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { Sizes, Spacing } from '@/theme';

/** Где прокручивается список: смещение и верх его окна на экране. */
export type StickyFrame = { scrollY: SharedValue<number>; listTop: SharedValue<number> };

/**
 * Чекбокс у длинного раскрытого пузыря «прилипает» к верху окна списка:
 * при прокрутке он остаётся на экране, двигаясь между верхним и нижним
 * краем пузыря. Считается в ворклете от прокрутки и рамки пузыря, без
 * перерисовки строки на каждый кадр.
 */
export function useStickyCheck(frame: StickyFrame | null, active: boolean) {
  const bubbleRef = useAnimatedRef<View>();
  const shift = useSharedValue(0);
  const scrollY = frame?.scrollY;
  const listTop = frame?.listTop;

  const place = () => {
    'worklet';

    if (!listTop) return;

    const box = measure(bubbleRef);

    if (!box) return;

    const room = Math.max(0, box.height - Sizes.selectionCheck);

    shift.set(Math.min(room, Math.max(0, listTop.get() + Spacing.two - box.pageY)));
  };

  useAnimatedReaction(
    () => (active && scrollY ? scrollY.get() : null),
    (value) => {
      if (value !== null) place();
    },
  );

  // Раскрыли или пузырь сменил размер — место заново, ещё до прокрутки.
  const onBubbleLayout = () => runOnUI(place)();

  const checkStyle = useAnimatedStyle(() => ({ transform: [{ translateY: shift.get() }] }));

  return { bubbleRef, checkStyle, onBubbleLayout };
}
