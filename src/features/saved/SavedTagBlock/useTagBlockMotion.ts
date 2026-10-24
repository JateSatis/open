import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/theme';

const EXPAND_MS = 220;

type Options = {
  expanded: boolean;
  /** Свёрнутая полоса. */
  collapsedHeight: number;
  /** Все теги целиком. */
  contentHeight: number;
  /** Раскрытый не ниже края экрана. */
  maxHeight: number;
  /** Верх блока в окне. */
  top: number;
};

/**
 * Высота блока тегов (раскрытие — только рост высоты, как у реакций),
 * поворот стрелки и подъём над клавиатурой поля имени. Меню — своё окно:
 * клавиатуру слушаем отсюда, как панель комментариев.
 */
export function useTagBlockMotion({
  expanded,
  collapsedHeight,
  contentHeight,
  maxHeight,
  top,
}: Options) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [keyboard, setKeyboard] = useState(0);

  useEffect(() => {
    const shown = KeyboardEvents.addListener('keyboardDidShow', (event) =>
      setKeyboard(event.height),
    );
    const hidden = KeyboardEvents.addListener('keyboardDidHide', () => setKeyboard(0));

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const room = keyboard > 0 ? windowHeight - keyboard - Spacing.two : windowHeight;
  const tallest = keyboard > 0 ? room - insets.top - Spacing.two : maxHeight;
  const target = expanded
    ? Math.max(collapsedHeight, Math.min(contentHeight, tallest))
    : collapsedHeight;
  // Над клавиатурой: блок поднимается ровно настолько, чтобы низ был виден.
  const lift = keyboard > 0 ? Math.max(0, top + target - room) : 0;

  const height = useSharedValue(target);
  const shift = useSharedValue(lift);
  const turn = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    height.set(withTiming(target, { duration: EXPAND_MS }));
    shift.set(withTiming(lift, { duration: EXPAND_MS }));
    turn.set(withTiming(expanded ? 1 : 0, { duration: EXPAND_MS }));
  }, [expanded, height, lift, shift, target, turn]);

  const blockStyle = useAnimatedStyle(() => ({
    height: height.value,
    marginTop: -shift.value,
  }));
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 180}deg` }],
  }));

  return { blockStyle, chevronStyle };
}
