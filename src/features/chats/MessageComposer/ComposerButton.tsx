import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { ComposerSizes, Opacity, Radii, Spacing } from '@/theme';

export type ComposerButtonProps = {
  icon: SymbolViewProps['name'];
  accessibilityLabel: string;
  /** `primary` — «Отправить» и «Сохранить»; `plain` — скрепка. */
  variant: 'primary' | 'plain';
  onPress: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  disabled?: boolean;
  /** Сколько медиа уйдёт с сообщением — кружок на кнопке. */
  count?: number;
  testID?: string;
};

/** Круглая кнопка у края панели ввода. */
export function ComposerButton({
  icon,
  accessibilityLabel,
  variant,
  onPress,
  onPressIn,
  onPressOut,
  disabled = false,
  count = 0,
  testID,
}: ComposerButtonProps) {
  const theme = useTheme();
  const primary = variant === 'primary';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? theme.primary : theme.backgroundElement },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <SymbolView
        name={icon}
        size={ComposerSizes.buttonIcon}
        tintColor={primary ? theme.primaryText : theme.textSecondary}
      />

      {count > 0 ? (
        <View
          style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.background }]}
        >
          <Text variant="caption" color="textInverse">
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: ComposerSizes.button,
    height: ComposerSizes.button,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: Opacity.disabled,
  },
  pressed: {
    opacity: Opacity.pressed,
  },
  badge: {
    position: 'absolute',
    top: -Spacing.one,
    right: -Spacing.one,
    minWidth: Spacing.four,
    height: Spacing.four,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
    borderWidth: 2,
  },
});
