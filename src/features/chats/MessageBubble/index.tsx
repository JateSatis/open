import { useMemo, useState } from 'react';
import { PixelRatio, Pressable, View } from 'react-native';

import { styles } from './styles';

import type { ReactionAudience } from '@/api/reactionCounts';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { ForwardedFrom } from '@/features/chats/ForwardedFrom';
import { computeMosaicLayout, type MosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { MediaAttachmentGrid } from '@/features/chats/MediaAttachmentGrid';
import { MessageMeta } from '@/features/chats/MessageMeta';
import { ReplyQuote } from '@/features/chats/ReplyQuote';
import type { ChatMessage } from '@/features/chats/useChatMessages';
import { VoiceMessage } from '@/features/chats/VoiceMessage';
import { MessageReactions, type ReactionsTone } from '@/features/interactions/MessageReactions';
import { hasReactions } from '@/features/interactions/reactionState';
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
  /** Тап по аватару или имени автора — его профиль. Нет автора (удалён) — нет и перехода. */
  onAuthorPress?: () => void;
  /** Тап по цитате ответа — к оригиналу. */
  onQuotePress?: () => void;
  /** Тап по «Переслано от» — к оригиналу в исходном чате. */
  onForwardPress?: () => void;
  /** Мой ряд реакций: тап по реакции в нём ставит или снимает её. */
  reactionAudience?: ReactionAudience;
  /** Тап по реакции своего ряда. Нет обработчика (копия в меню) — ряды не нажимаются. */
  onReactionToggle?: (emoji: string) => void;
};

export function MessageBubble({
  message,
  isOwn,
  isRead,
  authorName,
  authorAvatarUrl,
  mediaBounds,
  onRetry,
  onAuthorPress,
  onQuotePress,
  onForwardPress,
  reactionAudience,
  onReactionToggle,
}: MessageBubbleProps) {
  const theme = useTheme();
  const isMediaMessage = message.kind === 'media' && message.attachments.length > 0;
  const voice = message.kind === 'voice' ? message.attachments[0] : undefined;
  // Кружки пока не подключены к облачку — это отдельная задача; здесь только
  // заглушка, чтобы сообщение не было пустым.
  const hasUnhandledAttachment = !isMediaMessage && !voice && message.kind !== 'text';
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

  const hasAnnotations = message.forward !== null || message.replies.length > 0;

  // Откуда сообщение и на что оно отвечает — над содержимым, и у текста, и
  // у голосового, и у альбома.
  const annotations = hasAnnotations ? (
    <>
      {message.forward ? (
        <ForwardedFrom forward={message.forward} isOwn={isOwn} onPress={onForwardPress} />
      ) : null}
      {message.replies.length > 0 ? (
        <ReplyQuote quotes={message.replies} isOwn={isOwn} onPress={onQuotePress} />
      ) : null}
    </>
  ) : null;

  // Без подписи, имени и цитаты у своего альбома облачка нет — только
  // мозаика, и в её зазорах виден фон чата, как в Telegram.
  const bareMedia = !message.text && isOwn && !hasAnnotations;

  const reactions = (tone: ReactionsTone) => (
    <MessageReactions
      reactions={message.reactions}
      tone={tone}
      audience={reactionAudience}
      onToggle={onReactionToggle}
    />
  );

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
      {isOwn ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Профиль: ${authorName}`}
          disabled={!onAuthorPress}
          onPress={onAuthorPress}
        >
          <Avatar uri={authorAvatarUrl} name={authorName} size={Spacing.five} />
        </Pressable>
      )}

      {layout ? (
        // Медиа — само облачко: мозаика заподлицо с краями, скругление
        // облачка на ней. Подпись и имя автора — в полосах того же облачка.
        <View
          testID="message-bubble"
          style={[
            styles.mediaBubble,
            { width: layout.width, backgroundColor: bareMedia ? 'transparent' : bubbleColor },
          ]}
        >
          {isOwn ? null : (
            <Text
              variant="smallBold"
              color={textColor}
              style={styles.mediaAuthor}
              onPress={onAuthorPress}
              suppressHighlighting
            >
              {authorName}
            </Text>
          )}

          {annotations ? (
            <View style={[styles.mediaAnnotations, isOwn && styles.mediaAnnotationsOwn]}>
              {annotations}
            </View>
          ) : null}

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
              {reactions(isOwn ? 'own' : 'other')}
              {meta('inline')}
            </View>
          ) : bareMedia ? (
            // Облачка нет — ряды под мозаикой, на фоне чата.
            reactions('bare')
          ) : hasReactions(message.reactions) ? (
            <View style={styles.mediaReactions}>{reactions(isOwn ? 'own' : 'other')}</View>
          ) : null}
        </View>
      ) : (
        <View testID="message-bubble" style={[styles.bubble, { backgroundColor: bubbleColor }]}>
          {isOwn ? null : (
            <Text
              variant="smallBold"
              color={textColor}
              onPress={onAuthorPress}
              suppressHighlighting
            >
              {authorName}
            </Text>
          )}

          {annotations}

          {voice ? (
            <VoiceMessage attachment={voice} localUri={message.localPreviews?.[0]} isOwn={isOwn} />
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

          {message.text ? <Text color={textColor}>{message.text}</Text> : null}

          {reactions(isOwn ? 'own' : 'other')}

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
