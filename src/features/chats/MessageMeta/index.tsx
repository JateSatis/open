import { ActivityIndicator, Pressable, View } from 'react-native';

import { READ_OUTLINE, styles } from './styles';

import { Text } from '@/components/Text';
import { formatMessageTime } from '@/features/chats/chatDisplay';
import type { ChatMessage } from '@/features/chats/useChatMessages';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, type ThemeColor } from '@/theme';

const W = Sizes.metaReadOutline;
/** Белые копии времени под синим, сдвинутые во все стороны, — контур вокруг букв. */
const STROKE_OFFSETS = [
  [-W, -W],
  [0, -W],
  [W, -W],
  [-W, 0],
  [W, 0],
  [-W, W],
  [0, W],
  [W, W],
] as const;

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
  // На своём синем облачке синее время читается только в белом контуре; на
  // плашке медиа пилюля — сама плашка, она белеет.
  const outlined = read && !overlay;
  const whitePlate = read && overlay && READ_OUTLINE === 'pill';
  const time = formatMessageTime(message.createdAt);

  return (
    <View
      testID="message-meta"
      style={[
        styles.meta,
        overlay && [
          styles.overlay,
          { backgroundColor: whitePlate ? theme.metaReadOutline : theme.mediaScrim },
        ],
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
            style={outlined && READ_OUTLINE === 'pill' && styles.readPill}
          >
            {outlined && READ_OUTLINE === 'stroke'
              ? STROKE_OFFSETS.map(([x, y]) => (
                  <Text
                    key={`${x}:${y}`}
                    variant="meta"
                    color="metaReadOutline"
                    style={[styles.strokeCopy, { left: x, top: y }]}
                  >
                    {time}
                  </Text>
                ))
              : null}
            <Text variant="meta" color={read ? 'primary' : tone} style={pending && styles.hidden}>
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
            <Text variant="meta" color={whitePlate ? 'textSecondary' : tone}>
              изменено
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
