import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type SettingsRowProps = {
  title: string;
  subtitle?: string | null;
  /** Метка или кнопка справа. */
  accessory?: ReactNode;
  /** Разделитель сверху — у всех строк, кроме первой в карточке. */
  divided?: boolean;
  /** Строка целиком — кнопка: переход на экран или выбор значения. */
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
};

export function SettingsRow({
  title,
  subtitle,
  accessory,
  divided = false,
  onPress,
  testID,
  accessibilityLabel,
}: SettingsRowProps) {
  const theme = useTheme();
  const rowStyle = [styles.row, divided && [styles.divided, { borderTopColor: theme.border }]];
  const content = (
    <>
      <View style={styles.text}>
        <Text variant="body" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" color="textSecondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
    </>
  );

  if (!onPress) {
    return (
      <View testID={testID} style={rowStyle}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [rowStyle, pressed && { backgroundColor: theme.backgroundSelected }]}
    >
      {content}
    </Pressable>
  );
}
