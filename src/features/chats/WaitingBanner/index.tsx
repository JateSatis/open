import { View } from 'react-native';

import { styles } from './styles';

import type { Person } from '@/api/chats';
import { Text } from '@/components/Text';
import { listNames } from '@/features/chats/chatDisplay';
import { useTheme } from '@/hooks/use-theme';

export type WaitingBannerProps = {
  waiting: Person[];
};

/**
 * Кто из позванных ещё не принял заявку. Отказ здесь выглядит так же, как
 * молчание: этого различия у клиента просто нет (см. `chat_waiting_invitees`).
 */
export function WaitingBanner({ waiting }: WaitingBannerProps) {
  const theme = useTheme();

  if (waiting.length === 0) return null;

  return (
    <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
      <Text variant="small" color="textSecondary" numberOfLines={2}>
        {`Ждём ответа на заявку: ${listNames(waiting)}`}
      </Text>
    </View>
  );
}
