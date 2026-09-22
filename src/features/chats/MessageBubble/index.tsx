import { useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';

import { styles } from './styles';

import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { formatMessageTime } from '@/features/chats/chatDisplay';
import { MediaAttachmentGrid } from '@/features/chats/MediaAttachmentGrid';
import type { ChatMessage } from '@/features/chats/useChatMessages';
import { MediaViewer, type MediaViewerItem } from '@/features/media';
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
  const isMediaMessage = message.kind === 'media' && message.attachments.length > 0;
  // Остальные вложения (голосовые, кружки) пока не подключены к облачку —
  // это отдельная задача; здесь только заглушка, чтобы сообщение не было пустым.
  const hasUnhandledAttachment = !isMediaMessage && message.kind !== 'text';
  const [bubbleWidth, setBubbleWidth] = useState<number | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const onBubbleLayout = (event: LayoutChangeEvent) => {
    setBubbleWidth(event.nativeEvent.layout.width);
  };

  const viewerItems: MediaViewerItem[] = message.attachments.map((attachment) => ({
    id: attachment.id,
    kind: attachment.mimeType?.startsWith('video/') ? 'video' : 'photo',
    url: attachment.url,
  }));

  return (
    <View style={[styles.row, isOwn && styles.own]}>
      {isOwn ? null : <Avatar uri={authorAvatarUrl} name={authorName} size={Spacing.five} />}

      <View
        testID="message-bubble"
        onLayout={onBubbleLayout}
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

        {isMediaMessage && bubbleWidth !== null ? (
          <MediaAttachmentGrid
            attachments={message.attachments}
            containerWidth={bubbleWidth - Spacing.three * 2}
            onPress={setViewerIndex}
          />
        ) : null}

        {hasUnhandledAttachment ? (
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

      {isMediaMessage ? (
        <MediaViewer
          visible={viewerIndex !== null}
          items={viewerItems}
          initialIndex={viewerIndex ?? 0}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </View>
  );
}
