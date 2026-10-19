import { SymbolView } from 'expo-symbols';
import { forwardRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import type { InfoIcon } from './types';
import { usePhotoProgress } from './visual';

import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Spacing } from '@/theme';

export type InfoBarIconProps = { icon: InfoIcon };

/**
 * Иконка панели страницы: цветом текста, а поверх раскрытого фото — белая.
 * Две иконки друг на друге с перетеканием прозрачности: цвет самой иконки
 * анимировать нельзя.
 */
export function InfoBarIcon({ icon }: InfoBarIconProps) {
  const theme = useTheme();
  const photo = usePhotoProgress();

  const plainStyle = useAnimatedStyle(() => ({ opacity: 1 - (photo?.value ?? 0) }));
  const onPhotoStyle = useAnimatedStyle(() => ({ opacity: photo?.value ?? 0 }));

  // Обе иконки — в своей рамке: белая ложится ровно на обычную, а не в угол
  // кнопки с её полями.
  return (
    <View>
      <Animated.View style={plainStyle}>
        <SymbolView name={icon} size={InfoPageSizes.barIcon} tintColor={theme.text} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, onPhotoStyle]} pointerEvents="none">
        <SymbolView name={icon} size={InfoPageSizes.barIcon} tintColor={theme.textOnMedia} />
      </Animated.View>
    </View>
  );
}

export type InfoBarButtonProps = {
  icon: InfoIcon;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
};

/** Кнопка в панели страницы: стрелка назад, карандаш. */
export const InfoBarButton = forwardRef<View, InfoBarButtonProps>(function InfoBarButton(
  { icon, accessibilityLabel, onPress, testID },
  ref,
) {
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={Spacing.two}
      onPress={onPress}
      style={styles.button}
    >
      <InfoBarIcon icon={icon} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    padding: Spacing.two,
  },
});
