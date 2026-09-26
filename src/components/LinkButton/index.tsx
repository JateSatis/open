import { ActivityIndicator, Pressable } from 'react-native';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import type { ThemeColor } from '@/theme';

export type LinkButtonProps = {
  label: string;
  onPress: () => void;
  color?: ThemeColor;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
};

/** Действие-текст внутри строки или под списком: без фона и рамки. */
export function LinkButton({
  label,
  onPress,
  color = 'primary',
  loading = false,
  disabled = false,
  accessibilityLabel,
}: LinkButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  if (loading) {
    return <ActivityIndicator color={theme[color]} accessibilityLabel={`${label}…`} />;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      hitSlop={8}
      onPress={onPress}
    >
      <Text variant="bodyBold" color={isDisabled ? 'textSecondary' : color}>
        {label}
      </Text>
    </Pressable>
  );
}
