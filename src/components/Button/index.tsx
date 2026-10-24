import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'style'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Раскладка подписи: по ней родитель узнаёт, что подпись не влезла в строку. */
  onLabelLayout?: TextProps['onTextLayout'];
};

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  onLabelLayout,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const variantStyle: ViewStyle =
    variant === 'primary'
      ? { backgroundColor: theme.primary }
      : variant === 'danger'
        ? { backgroundColor: theme.danger }
        : variant === 'secondary'
          ? { backgroundColor: theme.backgroundElement }
          : { backgroundColor: 'transparent' };

  const textColor =
    variant === 'primary' || variant === 'danger'
      ? theme.primaryText
      : variant === 'secondary'
        ? theme.text
        : theme.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      style={[styles.base, styles[size], variantStyle, isDisabled && styles.disabled, style]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text
          variant="bodyBold"
          style={[styles.label, { color: textColor }]}
          onTextLayout={onLabelLayout}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
