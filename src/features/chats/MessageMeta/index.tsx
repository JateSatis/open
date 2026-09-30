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
  /** Кружок «доставлено / прочитано» у своего. Нет — у комментария: его никто не «читает». */
  showReceipt?: boolean;
};

/** Время и состояние доставки сообщения. */
export function MessageMeta({
  message,
  isOwn,
  isRead,
  variant,
  onRetry,
  showReceipt = true,
}: MessageMetaProps) {
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
      ) : message.editStatus === 'saving' ? (
        <Text variant="caption" color={color}>
          изменено · Сохраняется…
        </Text>
      ) : (
        <>
          {message.editedAt ? (
            <Text variant="caption" color={color}>
              изменено
            </Text>
          ) : null}

          <Text variant="caption" color={color}>
            {formatMessageTime(message.createdAt)}
          </Text>

          {isOwn && showReceipt ? (
            <View
              testID="message-receipt"
              accessible
              accessibilityLabel={isRead ? 'Прочитано' : 'Доставлено'}
              style={[
                styles.receipt,
                { borderColor: theme[color] },
                isRead && { backgroundColor: theme[color] },
              ]}
            />
          ) : null}
        </>
      )}
    </View>
  );
}
