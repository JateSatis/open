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

/**
 * Состояние иконки. Едет, не ушло или сохраняется правка — только моё
 * сообщение, даже если облачко не «своё» (пост канала стоит у левого края).
 * Галочки — только у своего.
 */
function deliveryState(
  message: ChatMessage,
  isOwn: boolean,
  isRead: boolean,
  receipts: boolean,
): DeliveryState | null {
  if (message.status === 'failed') return 'failed';
  if (message.status === 'sending' || message.editStatus === 'saving') return 'sending';
  // Время чата скрыто настройкой участника — галочек нет: «прочитано» скрыто
  // вместе с временем, а одна галочка у всех врала бы «не прочитано».
  if (!isOwn || !receipts || message.createdAt === null) return null;

  return isRead ? 'read' : 'sent';
}

/**
 * Время сообщения — всегда одного цвета. Справа от него у моего сообщения
 * иконка статуса, за ней — «ред.», если сообщение правили. Время чата скрыто
 * настройкой участника — ни часов, ни галочек; «ред.» остаётся: факт правки
 * времени не раскрывает. Показать нечего — плашки нет.
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
  const { localId, createdAt } = message;
  const edited = message.edited || message.editStatus === 'saving';

  if (!createdAt && !state && !edited) return null;

  return (
    <View
      testID="message-meta"
      style={[
        styles.meta,
        overlay && [styles.overlay, { backgroundColor: theme.mediaScrim }],
      ]}
    >
      {createdAt ? (
        <Text testID="message-time" variant="meta" color={tone}>
          {formatMessageTime(createdAt)}
        </Text>
      ) : null}

      {state ? (
        <DeliveryStatus
          state={state}
          tone={tone}
          onRetry={onRetry && localId ? () => onRetry(localId) : undefined}
        />
      ) : null}

      {edited ? (
        <Text variant="meta" color={tone}>
          ред.
        </Text>
      ) : null}
    </View>
  );
}
