import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { Ref } from 'react';
import { Pressable, type View } from 'react-native';

import { styles } from './styles';

import { useTheme } from '@/hooks/use-theme';
import { Opacity, Sizes } from '@/theme';

export type FloatingButtonProps = {
  /** Значок: SF Symbol на iOS, Material Symbol на Android. */
  icon: { ios: SFSymbol; android: AndroidSymbol };
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
  ref?: Ref<View>;
  /** Что лежит у нижнего края под кнопкой — панель вкладок: кнопка встаёт над ней. */
  bottomInset?: number;
};

/**
 * Круглая кнопка в правом нижнем углу экрана, над содержимым. Экран сам
 * оставляет списку нижний отступ, чтобы кнопка не закрывала последнюю строку.
 */
export function FloatingButton({
  icon,
  accessibilityLabel,
  onPress,
  testID,
  ref,
  bottomInset = 0,
}: FloatingButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { bottom: bottomInset + Sizes.floatingButtonMargin },
        { backgroundColor: theme.backgroundElement, shadowColor: theme.shadow },
        pressed && { opacity: Opacity.pressed },
      ]}
    >
      <SymbolView
        name={{ ios: icon.ios, android: icon.android, web: icon.android }}
        size={Sizes.floatingButtonIcon}
        tintColor={theme.text}
      />
    </Pressable>
  );
}
