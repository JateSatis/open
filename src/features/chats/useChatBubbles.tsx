import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { ForwardedComment, Person } from '@/api/chats';
import { CommentForwardLead } from '@/features/chats/CommentForwardLead';
import { MessageBubble } from '@/features/chats/MessageBubble';
import {
  commentsHomeOf,
  originalAsMessage,
  type BubbleRow,
  type IslandItemRow,
} from '@/features/chats/islands/rows';
import type { MosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { canReactTo } from '@/features/chats/messageActions';
import { DELETED_ACCOUNT } from '@/features/chats/messageQuote';
import type { ChatMessage } from '@/features/chats/messages/types';
import type { QuoteNavigation } from '@/features/chats/useQuoteNavigation';
import { commentsEntry } from '@/features/interactions/CommentsPanel';
import { sendReaction } from '@/features/interactions/reactionSender';
import { audienceOf, nextReaction } from '@/features/interactions/reactionState';
import type { ReactToMessage } from '@/features/interactions/useReactToMessage';
import type { ReactionAudience } from '@/api/reactionCounts';
import { openPopViewer } from '@/features/pops/openPopViewer';

type Options = {
  chatId: string;
  currentUserId: string | null;
  isMember: boolean;
  /** Люди переписки: участники и авторы, которых среди участников уже нет. */
  participantsById: ReadonlyMap<string, Person>;
  mediaBounds: MosaicBounds;
  retry: (localId: string) => void;
  openPerson: (personId: string) => void;
  navigation: QuoteNavigation;
  reactions: ReactToMessage;
  /**
   * Аватары у чужих облачков. У участника личного диалога их нет вовсе — и у
   * облачков островка тоже, даже если автор оригинала третий человек: его
   * видно по строке имени, а ряд облачков не пляшет по ширине.
   */
  showAvatars: boolean;
  /**
   * Имена над облачками собеседника. Нет у участника личного диалога; у
   * облачков островка имя автора оригинала остаётся всегда.
   */
  showAuthors?: boolean;
  /** Тап по сниппету пересланного комментария — к нему в его ветке. */
  openForwardedComment: (comment: ForwardedComment) => void;
  /**
   * Посты канала: подписаны этим именем, а не человеком, и все у левого
   * края — и у владельца тоже. Null — обычная переписка.
   */
  postAuthor?: string | null;
};

/** Облачко и то, в какой ряд в нём лягут мои реакции. */
export type ChatBubbles = {
  /** Облачко строки; `interactive: false` — копия в меню: ничего не нажимается. */
  bubbleFor: (row: BubbleRow, interactive: boolean) => React.ReactElement | null;
  /** Ряд моей реакции на облачко: у облачка островка — по участию в чате оригинала. */
  audienceFor: (row: BubbleRow) => ReactionAudience;
  /** Реакция на пересланный комментарий — его оригиналу. */
  reactToComment: (comment: ForwardedComment, emoji: string) => void;
};

/**
 * Облачка переписки: обычное сообщение и облачко островка. Облачко островка —
 * сам оригинал: его реакции, комментарии, время, правки и «прочитано» — из
 * чата оригинала, а подпись «<автор> из <чат>» — если он не из того чата, что
 * в заголовке островка.
 */
export function useChatBubbles({
  chatId,
  currentUserId,
  isMember,
  participantsById,
  mediaBounds,
  retry,
  openPerson,
  navigation,
  reactions,
  showAvatars,
  showAuthors = true,
  openForwardedComment,
  postAuthor = null,
}: Options): ChatBubbles {
  const queryClient = useQueryClient();
  const { openQuote, openOriginal } = navigation;
  const { audience: myAudience, toggle } = reactions;

  const audienceFor = useCallback(
    (row: BubbleRow): ReactionAudience => {
      const forwarded = row.type === 'message' ? row.message.commentForward?.comment : null;

      // Реакция на пересланный комментарий — его оригиналу, ряд — по чату комментария.
      if (forwarded) return audienceOf(forwarded.chat?.amMember ?? false);

      const original = row.type === 'island-item' ? row.item.original : null;

      // База решает ряд по участию в чате оригинала; это — её же правило.
      if (!original || original.chatId === chatId) return myAudience;

      return audienceOf(original.chat?.amMember ?? false);
    },
    [chatId, myAudience],
  );

  /** Реакция на пересланный комментарий ложится оригиналу — как у облачка островка. */
  const { me } = reactions;
  const reactToComment = useCallback(
    (comment: ForwardedComment, emoji: string) =>
      sendReaction(
        queryClient,
        comment.id,
        {
          emoji: nextReaction(comment.reactions.mine, emoji),
          audience: audienceOf(comment.chat?.amMember ?? false),
          me,
        },
        'comment',
      ),
    [me, queryClient],
  );

  // Под реакциями — свежие аватары участников чата, а не снимок из выборки.
  const resolvePerson = useCallback(
    (userId: string) => {
      const person = participantsById.get(userId);

      return person ? { name: person.displayName, avatarUrl: person.avatarUrl } : undefined;
    },
    [participantsById],
  );

  /**
   * Пересланный комментарий — сообщение переславшего: его место, цвет, время
   * и «прочитано». Сверху — откуда комментарий, ниже — сам он, с правкой и
   * реакциями оригинала.
   */
  const commentForwardBubble = useCallback(
    (item: ChatMessage, interactive: boolean) => {
      const forward = item.commentForward ?? { commentId: null, comment: null };
      const { comment } = forward;
      const author = item.authorId ? participantsById.get(item.authorId) : undefined;
      const commentAuthorId = comment?.authorId ?? null;
      const pop = comment?.pop ?? null;
      const shown: ChatMessage = comment
        ? {
            ...item,
            kind: comment.kind,
            text: comment.text,
            attachments: comment.attachments,
            editedAt: comment.editedAt,
            reactions: comment.reactions,
          }
        : { ...item, kind: 'text', text: null };

      return (
        <MessageBubble
          message={shown}
          isOwn={item.authorId === currentUserId}
          isRead={item.readAt !== null}
          authorName={author?.displayName ?? DELETED_ACCOUNT}
          authorAvatarUrl={author?.avatarUrl ?? null}
          mediaBounds={mediaBounds}
          onRetry={interactive ? retry : undefined}
          onAuthorPress={
            interactive && item.authorId ? () => openPerson(item.authorId!) : undefined
          }
          reactionAudience={audienceOf(comment?.chat?.amMember ?? false)}
          onReactionToggle={
            interactive && comment && item.status === 'sent'
              ? (emoji) => reactToComment(comment, emoji)
              : undefined
          }
          // Реакции комментария — один общий ряд, как в панели комментариев.
          reactionsLayout="merged"
          resolvePerson={resolvePerson}
          showAvatar={showAvatars}
          showAuthor={showAuthors}
          lead={
            <CommentForwardLead
              forward={forward}
              isOwn={item.authorId === currentUserId}
              onOpenSource={
                interactive && comment ? () => openForwardedComment(comment) : undefined
              }
              onOpenPop={
                interactive && pop ? () => openPopViewer(pop.channelId, pop.id) : undefined
              }
              onOpenAuthor={
                interactive && commentAuthorId ? () => openPerson(commentAuthorId) : undefined
              }
            />
          }
        />
      );
    },
    [
      currentUserId,
      mediaBounds,
      openForwardedComment,
      openPerson,
      participantsById,
      reactToComment,
      resolvePerson,
      retry,
      showAuthors,
      showAvatars,
    ],
  );

  const messageBubble = useCallback(
    (item: ChatMessage, interactive: boolean, rowKey: string) => {
      if (item.kind === 'comment_forward') return commentForwardBubble(item, interactive);

      const { authorId } = item;
      const author = authorId ? participantsById.get(authorId) : undefined;
      // Пост — голос канала: ни имени человека, ни «прочитано» участником.
      const isPost = postAuthor !== null;

      return (
        <MessageBubble
          message={item}
          isOwn={!isPost && item.authorId === currentUserId}
          isRead={!isPost && item.readAt !== null}
          receipts={!isPost}
          authorName={postAuthor ?? author?.displayName ?? DELETED_ACCOUNT}
          authorAvatarUrl={author?.avatarUrl ?? null}
          wide={isPost}
          mediaBounds={mediaBounds}
          onRetry={interactive ? retry : undefined}
          onAuthorPress={
            interactive && authorId && !isPost ? () => openPerson(authorId) : undefined
          }
          onQuotePress={interactive ? openQuote : undefined}
          reactionAudience={myAudience}
          onReactionToggle={
            interactive && canReactTo(item) ? (emoji) => toggle(item, emoji) : undefined
          }
          // Пост канала: все реакции одним рядом, без аватаров, нажимает любой.
          reactionsLayout={isPost ? 'mergedCounts' : 'split'}
          resolvePerson={resolvePerson}
          comments={commentsEntry(item, chatId, interactive, isMember)}
          commentsSlot
          showAvatar={showAvatars}
          showAuthor={showAuthors}
          // Выделять можно только в самой строке, не в её копии под меню.
          selectableText={
            interactive
              ? {
                  rowKey,
                  messageId: item.id,
                  chatId: item.chatId,
                  amMember: isMember,
                  // Скрыть от зрителей можно только своё; в канале — некому.
                  canHide: !isPost && item.authorId === currentUserId,
                }
              : undefined
          }
        />
      );
    },
    [
      chatId,
      commentForwardBubble,
      currentUserId,
      isMember,
      mediaBounds,
      myAudience,
      openPerson,
      openQuote,
      participantsById,
      postAuthor,
      resolvePerson,
      retry,
      showAuthors,
      showAvatars,
      toggle,
    ],
  );

  const islandBubble = useCallback(
    (row: IslandItemRow, interactive: boolean) => {
      const { original } = row.item;

      if (!original) return null;

      const message = originalAsMessage(original);
      const { authorId } = original;
      const home = commentsHomeOf(row, chatId, isMember);
      const audience = audienceFor(row);
      const fromHeaderChat = original.chatId === row.island.forward?.sourceChat?.id;

      return (
        <MessageBubble
          message={message}
          isOwn={authorId === currentUserId}
          // «Прочитано» — у самого оригинала: его увидел участник его чата.
          isRead={original.readAt !== null}
          authorName={original.authorName ?? DELETED_ACCOUNT}
          authorAvatarUrl={original.authorAvatarUrl}
          mediaBounds={mediaBounds}
          onAuthorPress={interactive && authorId ? () => openPerson(authorId) : undefined}
          // Цитаты оригинала — из его чата: туда и прыжок.
          onQuotePress={interactive ? (quote) => openQuote(quote, original.chatId) : undefined}
          sourceChat={
            fromHeaderChat
              ? null
              : {
                  name: original.chat?.name ?? 'удалённого чата',
                  onPress: interactive && original.chat ? () => openOriginal(message) : undefined,
                }
          }
          reactionAudience={audience}
          onReactionToggle={
            interactive && canReactTo(message)
              ? (emoji) => toggle(message, emoji, audience)
              : undefined
          }
          // Пересланный пост канала — как в самом канале.
          reactionsLayout={original.chat?.isChannelPosts ? 'mergedCounts' : 'split'}
          resolvePerson={resolvePerson}
          // Комментарии — к оригиналу: панель открывается на него, из его чата.
          comments={commentsEntry(message, home.chatId, interactive, home.amMember)}
          commentsSlot
          showAvatar={showAvatars}
          // Фрагмент облачка островка — фрагмент оригинала, как и его реакции.
          selectableText={
            interactive
              ? {
                  rowKey: row.key,
                  messageId: original.id,
                  chatId: original.chatId,
                  amMember: home.amMember,
                  canHide: authorId === currentUserId && !original.chat?.isChannelPosts,
                }
              : undefined
          }
        />
      );
    },
    [
      audienceFor,
      chatId,
      currentUserId,
      isMember,
      mediaBounds,
      openOriginal,
      openPerson,
      openQuote,
      resolvePerson,
      showAvatars,
      toggle,
    ],
  );

  const bubbleFor = useCallback(
    (row: BubbleRow, interactive: boolean) =>
      row.type === 'message'
        ? messageBubble(row.message, interactive, row.key)
        : islandBubble(row, interactive),
    [islandBubble, messageBubble],
  );

  return { bubbleFor, audienceFor, reactToComment };
}
