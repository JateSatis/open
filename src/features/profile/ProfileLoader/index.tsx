import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type ProfileLoaderProps = {
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
  children: ReactNode;
};

/** Loading and error shell shared by the own-profile and other-profile screens. */
export function ProfileLoader({ isPending, error, onRetry, children }: ProfileLoaderProps) {
  const theme = useTheme();

  if (isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Загрузка профиля" color={theme.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text color="textSecondary">Не удалось загрузить профиль</Text>
        <Button label="Повторить" variant="secondary" onPress={onRetry} />
      </View>
    );
  }

  return <>{children}</>;
}
