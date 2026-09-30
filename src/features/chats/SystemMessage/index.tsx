import { View } from 'react-native';

import { styles } from './styles';

import type { Message } from '@/api/chats';
import { Text } from '@/components/Text';
import { formatMessageTime } from '@/features/chats/chatDisplay';
import { callMarkText, isMissedCall } from '@/features/streams/callText';
import { useTheme } from '@/hooks/use-theme';

export type SystemMessageProps = {
  message: Message;
  currentUserId: string | null;
  isMember: boolean;
  /** Имя начавшего звонок — из участников чата. */
  hostName: string;
};

/**
 * Служебная строка посреди переписки: по центру, без облачка и автора. Это
 * не чья-то реплика, поэтому у неё нет ни меню, ни реакций, ни ответа.
 */
export function SystemMessage({ message, currentUserId, isMember, hostName }: SystemMessageProps) {
  const theme = useTheme();
  const viewer = { id: currentUserId, isMember };
  const text = message.call
    ? `📞 ${callMarkText(message.call, viewer, hostName)}`
    : (message.text ?? 'Служебное сообщение');
  const missed = message.call ? isMissedCall(message.call, viewer) : false;

  return (
    <View testID="system-message" style={styles.row}>
      <View style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
        {/* Время — продолжение строки: при переносе оно идёт за словами, а не висит сбоку. */}
        <Text variant="small" color={missed ? 'danger' : 'textSecondary'} style={styles.text}>
          {text}
          {'  '}
          <Text variant="caption" color="textSecondary">
            {formatMessageTime(message.createdAt)}
          </Text>
        </Text>
      </View>
    </View>
  );
}
