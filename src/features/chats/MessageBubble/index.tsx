import { useMemo, useState } from 'react';
import { PixelRatio, View } from 'react-native';

import { styles } from './styles';

import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { computeMosaicLayout, type MosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { MediaAttachmentGrid } from '@/features/chats/MediaAttachmentGrid';
import { MessageMeta } from '@/features/chats/MessageMeta';
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
  /**
   * Границы мозаики — от ширины списка, а не от `onLayout` облачка: размер
   * мозаики обязан быть известен в первом же рендере, иначе строка
   * перевёрнутого списка прыгает по высоте.
   */
  mediaBounds: MosaicBounds;
  onRetry: (localId: string) => void;
};

export function MessageBubble({
  message,
  isOwn,
  isRead,
  authorName,
  authorAvatarUrl,
  mediaBounds,
  onRetry,
}: MessageBubbleProps) {
  const theme = useTheme();
  const isMediaMessage = message.kind === 'media' && message.attachments.length > 0;
  // Остальные вложения (голосовые, кружки) пока не подключены к облачку —
  // это отдельная задача; здесь только заглушка, чтобы сообщение не было пустым.
  const hasUnhandledAttachment = !isMediaMessage && message.kind !== 'text';
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const textColor = isOwn ? 'primaryText' : 'text';
  const bubbleColor = isOwn ? theme.primary : theme.backgroundElement;

  // Список сообщений — горячий путь: раскладка пересчитывается только при
  // смене вложений или ширины, а не на каждую перерисовку строки.
  const layout = useMemo(
    () =>
      isMediaMessage
        ? computeMosaicLayout(message.attachments, mediaBounds, PixelRatio.get())
        : null,
    [isMediaMessage, message.attachments, mediaBounds],
  );

  const viewerItems: MediaViewerItem[] = message.attachments.map((attachment) => ({
    id: attachment.id,
    kind: attachment.mimeType?.startsWith('video/') ? 'video' : 'photo',
    url: attachment.url,
  }));

  const meta = (variant: 'inline' | 'overlay') => (
    <MessageMeta
      message={message}
      isOwn={isOwn}
      isRead={isRead}
      variant={variant}
      onRetry={onRetry}
    />
  );

  return (
    <View style={[styles.row, isOwn && styles.own]}>
      {isOwn ? null : <Avatar uri={authorAvatarUrl} name={authorName} size={Spacing.five} />}

      {layout ? (
        // Медиа — само облачко: мозаика заподлицо с краями, скругление
        // облачка на ней. Подпись и имя автора — в полосах того же облачка.
        <View
          testID="message-bubble"
          style={[
            styles.mediaBubble,
            {
              width: layout.width,
              // Без подписи и имени облачка нет — только мозаика, и в её
              // зазорах виден фон чата, как в Telegram.
              backgroundColor: !message.text && isOwn ? 'transparent' : bubbleColor,
            },
          ]}
        >
          {isOwn ? null : (
            <Text variant="smallBold" color={textColor} style={styles.mediaAuthor}>
              {authorName}
            </Text>
          )}

          <MediaAttachmentGrid
            attachments={message.attachments}
            layout={layout}
            localPreviews={message.localPreviews}
            onPress={setViewerIndex}
          >
            {message.text ? null : meta('overlay')}
          </MediaAttachmentGrid>

          {message.text ? (
            <View style={styles.caption}>
              <Text color={textColor}>{message.text}</Text>
              {meta('inline')}
            </View>
          ) : null}
        </View>
      ) : (
        <View testID="message-bubble" style={[styles.bubble, { backgroundColor: bubbleColor }]}>
          {isOwn ? null : (
            <Text variant="smallBold" color={textColor}>
              {authorName}
            </Text>
          )}

          {hasUnhandledAttachment ? (
            // Rendering and playback of media belong to the `media` feature; the
            // bubble only keeps the slot so a message carrying one is not blank.
            <View style={[styles.attachmentSlot, { backgroundColor: theme.backgroundSelected }]}>
              <Text variant="small" color="textSecondary">
                Вложение
              </Text>
            </View>
          ) : null}

          {message.text ? <Text color={textColor}>{message.text}</Text> : null}

          {meta('inline')}
        </View>
      )}

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
