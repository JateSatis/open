import { useMemo, useState, type ReactNode } from 'react';
import {
  PixelRatio,
  Pressable,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { BubbleFooter } from './BubbleFooter';
import { styles } from './styles';

import type { QuotedMessage } from '@/api/chats';
import type { ReactionAudience } from '@/api/reactionCounts';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { computeMosaicLayout, type MosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { MediaAttachmentGrid } from '@/features/chats/MediaAttachmentGrid';
import { MessageMeta } from '@/features/chats/MessageMeta';
import { ReplyQuote } from '@/features/chats/ReplyQuote';
import type { ChatMessage } from '@/features/chats/useChatMessages';
import { VoiceMessage } from '@/features/chats/VoiceMessage';
import { CommentsButton, type CommentsButtonTone } from '@/features/interactions/CommentsButton';
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
  /** Тап по цитате ответа — к её оригиналу. */
  onQuotePress?: (quote: QuotedMessage) => void;
  /**
   * Облачко островка, чей оригинал из другого чата, чем заголовок островка:
   * над текстом — «<автор> из <чат>». Тап по чату — туда, к этому сообщению.
   */
  sourceChat?: { name: string; onPress?: () => void } | null;
  /** Мой ряд реакций: тап по реакции в нём ставит или снимает её. */
  reactionAudience?: ReactionAudience;
  /** Тап по реакции своего ряда. Нет обработчика (копия в меню) — ряды не нажимаются. */
  onReactionToggle?: (emoji: string) => void;
  /**
   * Кнопка комментариев внутри облачка, у внешнего края: у чужого слева, у
   * своего справа. `quiet` — тихая кнопка участника на сообщении без
   * комментариев. Нет — нет и кнопки (неотправленное, системное, сам
   * комментарий).
   */
  comments?: { count: number; quiet?: boolean; onPress?: () => void };
  /** Тихая пометка после имени автора: «участник чата» у комментария. */
  authorBadge?: string | null;
  /** «доставлено / прочитано» у своего. У комментариев не показывается. */
  showReceipt?: boolean;
  /**
   * Аватар слева от чужого облачка. В личном диалоге его нет — и места под
   * него тоже: собеседник один, автора видно по имени над облачком.
   */
  showAvatar?: boolean;
  /**
   * Сбоку от облачка, со стороны середины экрана: у чужого — справа, у
   * своего — слева. Кнопка треда у корня комментариев.
   */
  aside?: ReactNode;
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
  sourceChat,
  reactionAudience,
  onReactionToggle,
  comments,
  authorBadge,
  showReceipt,
  showAvatar = true,
  aside,
}: MessageBubbleProps) {
  const theme = useTheme();
  const isMediaMessage = message.kind === 'media' && message.attachments.length > 0;
  const voice = message.kind === 'voice' ? message.attachments[0] : undefined;
  // Кружки пока не подключены к облачку — это отдельная задача; здесь только
  // заглушка, чтобы сообщение не было пустым.
  const hasUnhandledAttachment = !isMediaMessage && !voice && message.kind !== 'text';
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Ширина содержимого облачка — по ней низ решает, встанет ли кнопка
  // комментариев рядом с чипами.
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const hasMemberReactions = Object.keys(message.reactions.members).length > 0;
  const hasVisitorReactions = Object.keys(message.reactions.visitors).length > 0;
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
    width: attachment.width,
    height: attachment.height,
  }));

  const hasAnnotations = message.replies.length > 0;

  // На что сообщение отвечает — над содержимым, и у текста, и у голосового,
  // и у альбома.
  const annotations = hasAnnotations ? (
    <ReplyQuote quotes={message.replies} isOwn={isOwn} onPress={onQuotePress} />
  ) : null;

  // Своё облачко имени не показывает, но «из <чат>» у него остаётся.
  const showAuthorLine = !isOwn || Boolean(sourceChat);

  // Без подписи, имени и цитаты у своего альбома облачка нет — только
  // мозаика, и в её зазорах виден фон чата, как в Telegram.
  const bareMedia = !message.text && isOwn && !hasAnnotations && !sourceChat;

  const reactions = (tone: ReactionsTone, part?: 'members' | 'visitors') => (
    <MessageReactions
      reactions={message.reactions}
      tone={tone}
      audience={reactionAudience}
      onToggle={onReactionToggle}
      part={part}
    />
  );

  const meta = (variant: 'inline' | 'overlay', floating = true) => (
    <MessageMeta
      message={message}
      isOwn={isOwn}
      isRead={isRead}
      variant={variant}
      floating={floating}
      onRetry={onRetry}
      showReceipt={showReceipt}
    />
  );

  const commentsButton = (tone: CommentsButtonTone) =>
    comments ? (
      <CommentsButton
        count={comments.count}
        tone={tone}
        quiet={comments.quiet}
        onPress={comments.onPress}
      />
    ) : null;

  const footer = (tone: 'own' | 'other', width: number | null) => (
    <BubbleFooter
      isOwn={isOwn}
      members={hasMemberReactions ? reactions(tone, 'members') : null}
      visitors={hasVisitorReactions ? reactions(tone, 'visitors') : null}
      comments={commentsButton(tone)}
      quiet={comments?.quiet ?? false}
      meta={meta('inline')}
      contentWidth={width}
    />
  );

  const authorLine = (style?: StyleProp<TextStyle>) => (
    <Text variant="smallBold" color={textColor} style={style}>
      {isOwn ? null : (
        <Text variant="smallBold" color={textColor} onPress={onAuthorPress} suppressHighlighting>
          {authorName}
        </Text>
      )}
      {sourceChat ? (
        <Text variant="small" color={textColor}>
          {isOwn ? 'из ' : ' из '}
          <Text
            testID="message-source-chat"
            accessibilityRole={sourceChat.onPress ? 'link' : undefined}
            variant="smallBold"
            color={textColor}
            onPress={sourceChat.onPress}
            suppressHighlighting
          >
            {sourceChat.name}
          </Text>
        </Text>
      ) : null}
      {authorBadge ? (
        <Text variant="caption" color="textSecondary">
          {`  ${authorBadge}`}
        </Text>
      ) : null}
    </Text>
  );

  return (
    <View style={[styles.row, isOwn && styles.own]}>
      {isOwn || !showAvatar ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Профиль: ${authorName}`}
          disabled={!onAuthorPress}
          onPress={onAuthorPress}
        >
          <Avatar uri={authorAvatarUrl} name={authorName} size={Spacing.five} />
        </Pressable>
      )}

      {isOwn ? aside : null}

      {layout ? (
        // Медиа — само облачко: мозаика заподлицо с краями, скругление
        // облачка на ней. Подпись и имя автора — в полосах того же облачка.
        // Без облачка реакции — под ним: внутри их срезало бы скругление.
        <View style={[styles.mediaColumn, { width: layout.width }]}>
          <View
            testID="message-bubble"
            style={[
              styles.mediaBubble,
              { width: layout.width, backgroundColor: bareMedia ? 'transparent' : bubbleColor },
            ]}
          >
            {showAuthorLine ? authorLine(styles.mediaAuthor) : null}

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
              {message.text ? null : (
                // Без подписи время — плашкой на медиа, и кнопка комментариев
                // рядом, у внешнего края. Без облачка кнопка — под мозаикой.
                <View pointerEvents="box-none" style={styles.mediaOverlay}>
                  {isOwn || bareMedia ? null : commentsButton('overlay')}
                  <View style={styles.footerSpacer} />
                  {meta('overlay', false)}
                  {isOwn && !bareMedia ? commentsButton('overlay') : null}
                </View>
              )}
            </MediaAttachmentGrid>

            {message.text ? (
              <View style={styles.caption}>
                <Text color={textColor}>{message.text}</Text>
                {footer(isOwn ? 'own' : 'other', layout.width - Spacing.three * 2)}
              </View>
            ) : hasReactions(message.reactions) && !bareMedia ? (
              <View style={styles.mediaReactions}>{reactions(isOwn ? 'own' : 'other')}</View>
            ) : null}
          </View>
          {bareMedia && !message.text ? (
            <View style={styles.bareFooter}>
              <View style={styles.footerShrink}>{reactions('bare')}</View>
              {commentsButton('bare')}
            </View>
          ) : null}
        </View>
      ) : (
        <View testID="message-bubble" style={[styles.bubble, { backgroundColor: bubbleColor }]}>
          {/* Своей ширины — по самому широкому: её и меряет низ облачка. */}
          <View
            style={styles.content}
            onLayout={({ nativeEvent }) => setContentWidth(nativeEvent.layout.width)}
          >
            {showAuthorLine ? authorLine() : null}

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
          </View>

          {footer(isOwn ? 'own' : 'other', contentWidth)}
        </View>
      )}

      {isOwn ? null : aside}

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
