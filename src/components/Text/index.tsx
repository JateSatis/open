import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { Typography, type ThemeColor, type TypographyVariant } from '@/theme';

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  color?: ThemeColor;
};

export function Text({ style, variant = 'body', color = 'text', ...rest }: TextProps) {
  const theme = useTheme();

  return (
    <RNText
      style={[Typography[variant], { color: theme[color] }, style]}
      {...rest}
    />
  );
}
