import type { ReactNode } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type SettingsSectionProps = {
  title: string;
  /** Пояснение под карточкой — что значит этот раздел. */
  footer?: string;
  children: ReactNode;
};

/** Раздел экрана настроек: заголовок, карточка со строками, пояснение. */
export function SettingsSection({ title, footer, children }: SettingsSectionProps) {
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <Text variant="smallBold" color="textSecondary" style={styles.title}>
        {title}
      </Text>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>{children}</View>
      {footer ? (
        <Text variant="caption" color="textSecondary" style={styles.footer}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}
