import { View } from 'react-native';

import { DeliveryStatus, type DeliveryState } from './DeliveryStatus';
import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatMessageTime } from '@/features/chats/chatDisplay';
import type { ChatMessage } from '@/features/chats/useChatMessages';
import { useTheme } from '@/hooks/use-theme';
import type { ThemeColor } from '@/theme';

export type MessageMetaProps = {
  message: ChatMessage;
  isOwn: boolean;
  /** Своё сообщение увидел другой участник чата: две галочки. У чужого не значит ничего. */
  isRead: boolean;
  /**
   * `overlay` — полупрозрачная плашка поверх медиа без подписи, как в
   * Telegram; `inline` — строка в низу облачка.
   */
  variant: 'inline' | 'overlay';
  /** Тап по значку ошибки. Нет — значок не нажимается (копия облачка). */
  onRetry?: (localId: string) => void;
  /**
   * Галочки «отправлено» и «прочитано». У поста канала их нет: прочтение
   * участником у него ничего не значит — остаются лоадер и ошибка.
   */
  receipts?: boolean;
};

/** Состояние иконки у моего сообщения; у чужого иконки нет. */
function deliveryState(
  message: ChatMessage,
  isOwn: boolean,
  isRead: boolean,
  receipts: boolean,
): DeliveryState | null {
  if (!isOwn) return null;
  if (message.status === 'failed') return 'failed';
  if (message.status === 'sending' || message.editStatus === 'saving') return 'sending';
  if (!receipts) return null;

  return isRead ? 'read' : 'sent';
}

/**
 * Время сообщения — всегда видно и всегда одного цвета. Справа от него у
 * моего сообщения иконка статуса, за ней — «ред.», если сообщение правили.
 */
export function MessageMeta({
  message,
  isOwn,
  isRead,
  variant,
  onRetry,
  receipts = true,
}: MessageMetaProps) {
  const theme = useTheme();
  const overlay = variant === 'overlay';
  const tone: ThemeColor = overlay ? 'textOnMedia' : isOwn ? 'metaOnPrimary' : 'textSecondary';
  const state = deliveryState(message, isOwn, isRead, receipts);
  const { localId } = message;

  return (
    <View
      testID="message-meta"
      style={[
        styles.meta,
        overlay && [styles.overlay, { backgroundColor: theme.mediaScrim }],
      ]}
    >
      <Text testID="message-time" variant="meta" color={tone}>
        {formatMessageTime(message.createdAt)}
      </Text>

      {state ? (
        <DeliveryStatus
          state={state}
          tone={tone}
          onRetry={onRetry && localId ? () => onRetry(localId) : undefined}
        />
      ) : null}

      {message.editedAt || message.editStatus === 'saving' ? (
        <Text variant="meta" color={tone}>
          ред.
        </Text>
      ) : null}
    </View>
  );
}
