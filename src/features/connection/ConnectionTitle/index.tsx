import { ActivityIndicator, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';

export type ConnectionTitleProps = {
  /** Что писать, когда со связью всё в порядке. */
  title: string;
};

const LABELS = {
  offline: 'Нет сети',
  connecting: 'Подключение…',
} as const;

/**
 * Заголовок экрана, который во время обрыва связи говорит о её состоянии.
 *
 * Показывать это в шапке, а не всплывающей плашкой, — сознательное решение:
 * так видно, что приложение не зависло, и при этом ничего не перекрывается.
 */
export function ConnectionTitle({ title }: ConnectionTitleProps) {
  const status = useConnectionStatus();

  if (status === 'online') {
    return (
      <Text variant="bodyBold" numberOfLines={1}>
        {title}
      </Text>
    );
  }

  return (
    <View style={styles.row}>
      {status === 'connecting' ? <ActivityIndicator size="small" /> : null}
      <Text variant="bodyBold" color="textSecondary" numberOfLines={1}>
        {LABELS[status]}
      </Text>
    </View>
  );
}
