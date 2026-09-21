import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { formatMessageTime } from '@/features/chats/chatDisplay';
import type { ChatMessage } from '@/features/chats/useChatMessages';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type MessageBubbleProps = {
  message: ChatMessage;
  isOwn: boolean;
  /** Собеседник дочитал переписку до этого сообщения. Смысл имеет только для своих. */
  isRead: boolean;
  authorName: string;
  authorAvatarUrl: string | null;
  onRetry: (localId: string) => void;
};

export function MessageBubble({
  message,
  isOwn,
  isRead,
  authorName,
  authorAvatarUrl,
  onRetry,
}: MessageBubbleProps) {
  const theme = useTheme();
  const failed = message.status === 'failed';
  const hasAttachments = message.attachments.length > 0 || message.kind !== 'text';

  return (
    <View style={[styles.row, isOwn && styles.own]}>
      {isOwn ? null : <Avatar uri={authorAvatarUrl} name={authorName} size={Spacing.five} />}

      <View
        style={[
          styles.bubble,
          { backgroundColor: isOwn ? theme.primary : theme.backgroundElement },
        ]}
      >
        {isOwn ? null : (
          <Text variant="smallBold" color={isOwn ? 'primaryText' : 'text'}>
            {authorName}
          </Text>
        )}

        {hasAttachments ? (
          // Rendering and playback of media belong to the `media` feature; the
          // bubble only keeps the slot so a message carrying one is not blank.
          <View style={[styles.attachmentSlot, { backgroundColor: theme.backgroundSelected }]}>
            <Text variant="small" color="textSecondary">
              Вложение
            </Text>
          </View>
        ) : null}

        {message.text ? <Text color={isOwn ? 'primaryText' : 'text'}>{message.text}</Text> : null}

        <View style={styles.meta}>
          {message.status === 'sending' ? (
            <Text variant="caption" color={isOwn ? 'primaryText' : 'textSecondary'}>
              Отправляется…
            </Text>
          ) : failed ? (
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
              <Text variant="caption" color={isOwn ? 'primaryText' : 'textSecondary'}>
                {formatMessageTime(message.createdAt)}
              </Text>

              {isOwn ? (
                <Text variant="caption" color="primaryText">
                  {isRead ? 'прочитано' : 'доставлено'}
                </Text>
              ) : null}
            </>
          )}
        </View>
      </View>
    </View>
  );
}
