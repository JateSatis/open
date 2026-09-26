import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatMessageTime } from '@/features/chats/chatDisplay';
import type { ChatMessage } from '@/features/chats/useChatMessages';
import { useTheme } from '@/hooks/use-theme';
import type { ThemeColor } from '@/theme';

export type MessageMetaProps = {
  message: ChatMessage;
  isOwn: boolean;
  isRead: boolean;
  /**
   * `overlay` — полупрозрачная плашка поверх медиа без подписи, как в
   * Telegram; `inline` — строка под текстом в облачке.
   */
  variant: 'inline' | 'overlay';
  onRetry: (localId: string) => void;
};

/** Время и состояние доставки сообщения. */
export function MessageMeta({ message, isOwn, isRead, variant, onRetry }: MessageMetaProps) {
  const theme = useTheme();
  const overlay = variant === 'overlay';
  const color: ThemeColor = overlay ? 'textOnMedia' : isOwn ? 'primaryText' : 'textSecondary';

  return (
    <View
      testID="message-meta"
      style={[styles.meta, overlay && [styles.overlay, { backgroundColor: theme.mediaScrim }]]}
    >
      {message.status === 'sending' ? (
        <Text variant="caption" color={color}>
          Отправляется…
        </Text>
      ) : message.status === 'failed' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => message.localId && onRetry(message.localId)}
        >
          <Text variant="caption" color="danger">
            Не отправлено. Повторить
          </Text>
        </Pressable>
      ) : (
        <>
          <Text variant="caption" color={color}>
            {formatMessageTime(message.createdAt)}
          </Text>

          {isOwn ? (
            <Text variant="caption" color={overlay ? color : 'primaryText'}>
              {isRead ? 'прочитано' : 'доставлено'}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
