import { ActivityIndicator, Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatMessageTime } from '@/features/chats/chatDisplay';
import type { ChatMessage } from '@/features/chats/useChatMessages';
import { useTheme } from '@/hooks/use-theme';
import type { ThemeColor } from '@/theme';

export type MessageMetaProps = {
  message: ChatMessage;
  isOwn: boolean;
  /** Своё сообщение увидел другой участник чата: время синее. У чужого не значит ничего. */
  isRead: boolean;
  /**
   * `overlay` — полупрозрачная плашка поверх медиа без подписи, как в
   * Telegram; `inline` — строка в низу облачка.
   */
  variant: 'inline' | 'overlay';
  onRetry: (localId: string) => void;
  /**
   * Плашка на медиа сама прижимается к углу. `false` — её ставит родитель,
   * в строку рядом с просмотрами и кнопкой комментариев.
   */
  floating?: boolean;
};

/**
 * Время сообщения — оно же состояние доставки: пока сообщение едет, на его
 * месте лоадер; доехало — серое; его увидел другой участник — синее.
 */
export function MessageMeta({
  message,
  isOwn,
  isRead,
  variant,
  onRetry,
  floating = true,
}: MessageMetaProps) {
  const theme = useTheme();
  const overlay = variant === 'overlay';
  const tone: ThemeColor = overlay ? 'textOnMedia' : isOwn ? 'metaOnPrimary' : 'textSecondary';
  const pending = message.status === 'sending' || message.editStatus === 'saving';
  const read = isOwn && isRead && !pending;
  // На своём синем облачке синее время читается только в белом контуре.
  const outlined = read && !overlay;
  const time = formatMessageTime(message.createdAt);

  return (
    <View
      testID="message-meta"
      style={[
        styles.meta,
        overlay && [styles.overlay, { backgroundColor: theme.mediaScrim }],
        overlay && floating && styles.floating,
      ]}
    >
      {message.status === 'failed' ? (
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
          {/* Лоадер встаёт на место времени, а место держит само время —
              невидимым: облачко не прыгает, когда сообщение доехало. */}
          <View
            testID="message-time"
            accessible
            accessibilityLabel={pending ? 'Отправляется' : read ? `${time}, прочитано` : time}
            style={outlined && styles.readPill}
          >
            <Text
              variant="meta"
              color={read ? 'primary' : tone}
              style={[pending && styles.hidden, outlined && styles.readStroke]}
            >
              {time}
            </Text>
            {pending ? (
              <View style={styles.spinnerBox}>
                <ActivityIndicator
                  testID="message-sending"
                  size="small"
                  color={theme[tone]}
                  style={styles.spinner}
                />
              </View>
            ) : null}
          </View>

          {message.editedAt || message.editStatus === 'saving' ? (
            <Text variant="meta" color={tone}>
              изменено
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
