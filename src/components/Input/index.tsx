import { TextInput, View, type TextInputProps } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type InputProps = TextInputProps & {
  label?: string;
  error?: string;
  /**
   * Неизменяемая приставка справа внутри рамки — например, `.ch` у имени
   * канала. Это не текст поля: курсор на неё не заходит, в значение она не
   * попадает.
   */
  suffix?: string;
};

export function Input({ label, error, suffix, style, ...rest }: InputProps) {
  const theme = useTheme();
  const border = { borderColor: error ? theme.danger : theme.border };

  return (
    <View style={styles.container}>
      {label ? <Text variant="smallBold">{label}</Text> : null}
      {suffix ? (
        <View style={[styles.field, styles.withSuffix, border]}>
          <TextInput
            placeholderTextColor={theme.textSecondary}
            style={[styles.bare, { color: theme.text }, style]}
            {...rest}
          />
          <Text testID={rest.testID ? `${rest.testID}-suffix` : undefined} color="textSecondary">
            {suffix}
          </Text>
        </View>
      ) : (
        <TextInput
          placeholderTextColor={theme.textSecondary}
          style={[styles.field, { color: theme.text }, border, style]}
          {...rest}
        />
      )}
      {error ? (
        <Text variant="small" color="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
