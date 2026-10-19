import { useMemo, useState, type ReactNode } from 'react';
import { PixelRatio, Pressable, View, type StyleProp, type TextStyle } from 'react-native';

import { BubbleFooter } from './BubbleFooter';
import { BubbleGlow } from './BubbleGlow';
import { BUBBLE_AVATAR } from './layout';
import { styles } from './styles';
import { useMediaViewJournal } from './useMediaViewJournal';

import type { QuotedMessage } from '@/api/chats';
import type { ReactionAudience } from '@/api/reactionCounts';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import {
  computeMosaicLayout,
  popPostLayout,
  type MosaicBounds,
} from '@/features/chats/lib/mosaicLayout';
import { MediaAttachmentGrid } from '@/features/chats/MediaAttachmentGrid';
import { tileImageUri } from '@/features/chats/MediaTile';
import { MessageMeta } from '@/features/chats/MessageMeta';
import { ReplyQuote } from '@/features/chats/ReplyQuote';
import type { ChatMessage } from '@/features/chats/useChatMessages';
import { ViewsCount, type ViewsCountTone } from '@/features/chats/ViewsCount';
import { VoiceMessage } from '@/features/chats/VoiceMessage';
import { hasClusters } from '@/features/chats/fragments/fragmentRules';
import { useFragmentModeActive } from '@/features/chats/fragments/fragmentStore';
import { SelectableText } from '@/features/chats/fragments/SelectableText';
import { CommentsCircle } from '@/features/interactions/CommentsCircle';
import {
  LargeReactionRow,
  VisitorReactions,
  type ReactionsLayout,
  type ReactionsTone,
  type ResolvePerson,
} from '@/features/interactions/MessageReactions';
import { hasReactions } from '@/features/interactions/reactionState';
import { MediaViewer, type MediaViewerItem } from '@/features/media';
import { useArmedViewer } from '@/features/media/MediaViewer/useArmedViewer';
import { createTileRegistry } from '@/features/media/tileRegistry';
import { openPopViewer } from '@/features/pops/openPopViewer';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type MessageBubbleProps = {
  message: ChatMessage;
  isOwn: boolean;
  /** Своё сообщение увидел другой участник чата — две галочки. Смысл имеет только для своих. */
  isRead: boolean;
  /** Галочки «отправлено» и «прочитано» у своего. У поста канала их нет. */
  receipts?: boolean;
  authorName: string;
  authorAvatarUrl: string | null;
  /**
   * Границы мозаики — от ширины списка, а не от `onLayout` облачка: размер
   * мозаики обязан быть известен в первом же рендере, иначе строка
   * перевёрнутого списка прыгает по высоте.
   */
  mediaBounds: MosaicBounds;
  /** Тап по значку ошибки. Нет — значок не нажимается (копия облачка). */
  onRetry?: (localId: string) => void;
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
   * Как разложены реакции: у сообщения — крупный ряд участников и строка
   * зрителей, у комментария и поста канала — один общий ряд.
   */
  reactionsLayout?: ReactionsLayout;
  /** Свежие имя и фото поставившего реакцию — из участников чата. */
  resolvePerson?: ResolvePerson;
  /**
   * Круг комментариев сбоку от облачка, со стороны середины экрана: у
   * чужого — справа, у своего — слева. Нет — нет и круга (неотправленное,
   * системное, у участника — пока нет комментариев).
   */
  comments?: { count: number; onPress?: () => void };
  /**
   * Место под круг комментариев держится, даже пока круга нет: облачко не
   * перестраивается, когда появляется первый комментарий. У облачка в
   * панели комментариев круга не бывает — и места тоже.
   */
  commentsSlot?: boolean;
  /** Тихая пометка после имени автора: «участник чата» у комментария. */
  authorBadge?: string | null;
  /** Счётчик просмотров в правом нижнем углу. У комментариев его нет: их просмотры не считаются. */
  showViews?: boolean;
  /**
   * Аватар слева от чужого облачка. У участника личного диалога его нет — и
   * места под него тоже: собеседник один.
   */
  showAvatar?: boolean;
  /**
   * Имя над чужим облачком. Участнику личного диалога оно ни к чему: кроме
   * него, в переписке один человек. «Из <чат>» от этого не пропадает.
   */
  showAuthor?: boolean;
  /** Пост канала: облачко шире обычного (`Sizes.postBubbleShare`). */
  wide?: boolean;
  /**
   * Блок над содержимым облачка, выше цитат: у пересланного комментария —
   * откуда он и под каким сообщением оставлен.
   */
  lead?: ReactNode;
  /**
   * В тексте можно выделять (режим фрагментов): строка облачка и сообщение,
   * чей это текст, — у облачка островка оригинал. Нет — обычный текст.
   */
  selectableText?: { rowKey: string; messageId: string; chatId: string; amMember: boolean };
};

const noop = () => undefined;

export function MessageBubble({
  message,
  isOwn,
  isRead,
  receipts = true,
  authorName,
  authorAvatarUrl,
  mediaBounds,
  onRetry,
  onAuthorPress,
  onQuotePress,
  sourceChat,
  reactionAudience,
  onReactionToggle,
  reactionsLayout = 'split',
  resolvePerson,
  comments,
  commentsSlot = false,
  authorBadge,
  showViews = true,
  showAvatar = true,
  showAuthor = true,
  wide = false,
  lead,
  selectableText,
}: MessageBubbleProps) {
  const theme = useTheme();
  const fragmentMode = useFragmentModeActive(selectableText?.rowKey);
  const isMediaMessage = message.kind === 'media' && message.attachments.length > 0;
  // Пост с попом: обложка попа, а не мозаика; тап — просмотр попсов его канала.
  const isPopPost = isMediaMessage && Boolean(message.attachments[0]?.popId);
  const popLink = isPopPost ? message.attachments[0] : undefined;
  // Оптимистичный пост с новым попом ещё не знает канала, удалённый поп не открыть.
  const openPop =
    popLink?.popId && popLink.popChannelId && !popLink.popDeleted
      ? () => openPopViewer(popLink.popChannelId!, popLink.popId!)
      : noop;
  const voice = message.kind === 'voice' ? message.attachments[0] : undefined;
  // Облачко комментария — тот же компонент; журнал пишет только сообщения.
  const isComment = 'targetId' in message;
  // Кружки пока не подключены к облачку — это отдельная задача; здесь только
  // заглушка, чтобы сообщение не было пустым.
  const hasUnhandledAttachment = !isMediaMessage && !voice && message.kind !== 'text';
  const {
    viewer,
    open: openViewer,
    arm: armViewer,
    disarm: disarmViewer,
    close: closeViewer,
  } = useArmedViewer();
  // Плитки этого облачка: просмотр листает только его вложения и уходит в
  // плитку того, на котором закрыли.
  const [tiles] = useState(createTileRegistry);
  const anyReactions = hasReactions(message.reactions);
  const hasLargeRow =
    reactionsLayout === 'split' ? Object.keys(message.reactions.members).length > 0 : anyReactions;
  const hasVisitorLine =
    reactionsLayout === 'split' && Object.keys(message.reactions.visitors).length > 0;
  const textColor = isOwn ? 'primaryText' : 'text';
  // Ореол — у всех, в режиме и вне его: кусками этого текста уже интересовались.
  const glowing = hasClusters(message);
  const bubbleColor = fragmentMode
    ? isOwn
      ? theme.fragmentBubbleOwn
      : theme.fragmentBubble
    : isOwn
      ? theme.primary
      : theme.backgroundElement;

  // Список сообщений — горячий путь: раскладка пересчитывается только при
  // смене вложений или ширины, а не на каждую перерисовку строки.
  const layout = useMemo(
    () =>
      isPopPost
        ? popPostLayout(mediaBounds, PixelRatio.get())
        : isMediaMessage
          ? computeMosaicLayout(message.attachments, mediaBounds, PixelRatio.get())
          : null,
    [isMediaMessage, isPopPost, message.attachments, mediaBounds],
  );

  const viewerItems: MediaViewerItem[] = message.attachments.map((attachment) => ({
    id: attachment.id,
    kind: attachment.mimeType?.startsWith('video/') ? 'video' : 'photo',
    url: attachment.url,
    thumbUrl: tileImageUri(attachment),
    width: attachment.width,
    height: attachment.height,
  }));

  useMediaViewJournal(
    isMediaMessage && !isPopPost ? viewer : null,
    isComment ? undefined : message.id,
    viewerItems.map((item) => item.kind),
  );

  const hasAnnotations = message.replies.length > 0 || Boolean(lead);

  // На что сообщение отвечает — над содержимым, и у текста, и у голосового,
  // и у альбома.
  const annotations = hasAnnotations ? (
    <>
      {lead}
      {message.replies.length > 0 ? (
        <ReplyQuote quotes={message.replies} isOwn={isOwn} onPress={onQuotePress} />
      ) : null}
    </>
  ) : null;

  // Своё облачко имени не показывает, но «из <чат>» у него остаётся.
  const namesAuthor = !isOwn && showAuthor;
  const showAuthorLine = namesAuthor || Boolean(sourceChat);

  // Полоска статуса лежит поверх медиа, только пока под ним ничего нет: ни
  // подписи, ни одной реакции. Иначе она — нижняя строка облачка под медиа.
  // Признак один на всё: от него же скругление низа мозаики и фон облачка.
  const metaOnMedia = !message.text && !anyReactions;
  // Без подписи, имени, цитаты и реакций у альбома облачка нет — только
  // мозаика, и в её зазорах виден фон чата, как в Telegram. С первой реакцией
  // облачко появляется: реакции и полоска стоят в нём, под мозаикой.
  const bareMedia = metaOnMedia && !showAuthorLine && !hasAnnotations;
  // Какими краями мозаика касается краёв облачка: там её углы скруглены.
  const mosaicTop = !showAuthorLine && !hasAnnotations;
  const mosaicBottom = metaOnMedia;
  const mosaicEdges = useMemo(
    () => ({ top: mosaicTop, bottom: mosaicBottom }),
    [mosaicBottom, mosaicTop],
  );
  const tone: ReactionsTone = isOwn ? 'own' : 'other';

  const reactionProps = {
    memoryKey: message.id,
    reactions: message.reactions,
    tone,
    layout: reactionsLayout,
    audience: reactionAudience,
    onToggle: onReactionToggle,
    resolvePerson,
  };
  const largeRow = hasLargeRow ? <LargeReactionRow {...reactionProps} /> : null;
  const visitorLine = hasVisitorLine ? <VisitorReactions {...reactionProps} /> : null;

  const meta = (variant: 'inline' | 'overlay') => (
    <MessageMeta
      message={message}
      isOwn={isOwn}
      isRead={isRead}
      receipts={receipts}
      variant={variant}
      onRetry={onRetry}
    />
  );

  // Пока сообщение едет или его никто не видел, счётчика нет.
  const views = (tone: ViewsCountTone) =>
    showViews && message.status === 'sent' && message.viewsCount > 0 ? (
      <ViewsCount count={message.viewsCount} tone={tone} />
    ) : null;

  const footer = (
    <BubbleFooter
      meta={meta('inline')}
      reactions={largeRow}
      views={views(tone)}
      visitors={visitorLine}
    />
  );

  // Строка тянется по самому высокому, а место круга прижато к её низу —
  // низ круга вровень с низом облачка.
  const aside =
    commentsSlot || comments ? (
      <View testID="comments-slot" style={styles.aside}>
        {comments ? <CommentsCircle count={comments.count} onPress={comments.onPress} /> : null}
      </View>
    ) : null;

  const body = message.text ? (
    <SelectableText
      text={message.text}
      isOwn={isOwn}
      rowKey={selectableText?.rowKey}
      messageId={selectableText?.messageId ?? message.id}
      chatId={selectableText?.chatId ?? message.chatId}
      amMember={selectableText?.amMember ?? false}
      clustersCount={message.clustersCount}
    />
  ) : null;

  const authorLine = (style?: StyleProp<TextStyle>) => (
    <Text variant="smallBold" color={textColor} style={style}>
      {namesAuthor ? (
        <Text variant="smallBold" color={textColor} onPress={onAuthorPress} suppressHighlighting>
          {authorName}
        </Text>
      ) : null}
      {sourceChat ? (
        <Text variant="small" color={textColor}>
          {namesAuthor ? ' из ' : 'из '}
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
          <Avatar uri={authorAvatarUrl} name={authorName} size={BUBBLE_AVATAR} />
        </Pressable>
      )}

      {isOwn ? aside : null}

      {layout ? (
        // Медиа — само облачко: мозаика заподлицо с краями, скругление
        // облачка на ней. Подпись и имя автора — в полосах того же облачка.
        // Без подписи реакции — тоже полосой облачка, под мозаикой.
        <View style={[styles.mediaColumn, { width: layout.width }]}>
          {glowing ? <BubbleGlow isOwn={isOwn} /> : null}
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
              onPress={isPopPost ? openPop : openViewer}
              tiles={tiles}
              edges={mosaicEdges}
              onArm={isPopPost ? undefined : armViewer}
              onDisarm={isPopPost ? undefined : disarmViewer}
            >
              {metaOnMedia ? (
                // Под медиа ничего нет — время со статусом плашкой в левом
                // нижнем углу медиа, просмотры — в правом.
                <View
                  testID="media-meta-overlay"
                  pointerEvents="box-none"
                  style={styles.mediaOverlay}
                >
                  {meta('overlay')}
                  <View style={styles.footerSpacer} />
                  {views('overlay')}
                </View>
              ) : null}
            </MediaAttachmentGrid>

            {message.text ? (
              <View style={styles.caption}>
                {body}
                {footer}
              </View>
            ) : metaOnMedia ? null : (
              <View style={styles.mediaReactions}>{footer}</View>
            )}
          </View>
        </View>
      ) : (
        <View
          testID="message-bubble"
          style={[styles.bubble, wide && styles.wide, { backgroundColor: bubbleColor }]}
        >
          {glowing ? <BubbleGlow isOwn={isOwn} inset={Spacing.two} /> : null}
          <View style={styles.content}>
            {showAuthorLine ? authorLine() : null}

            {annotations}

            {voice ? (
              <VoiceMessage
                attachment={voice}
                localUri={message.localPreviews?.[0]}
                isOwn={isOwn}
                messageId={isComment ? undefined : message.id}
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

            {body}
          </View>

          {footer}
        </View>
      )}

      {isOwn ? null : aside}

      {isMediaMessage && !isPopPost ? (
        <MediaViewer
          // Другая плитка, чем под пальцем, — другой просмотр с нуля.
          key={viewer?.index}
          visible={viewer !== null}
          armed={viewer?.armed}
          items={viewerItems}
          initialIndex={viewer?.index ?? 0}
          origin={viewer?.origin}
          tiles={tiles}
          onClose={closeViewer}
        />
      ) : null}
    </View>
  );
}
