import type { ReactNode } from 'react';
import { View } from 'react-native';

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
};

export function SettingsRow({ title, subtitle, accessory, divided = false }: SettingsRowProps) {
  const theme = useTheme();

  return (
    <View
      style={[styles.row, divided && [styles.divided, { borderTopColor: theme.border }]]}
    >
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
    </View>
  );
}
