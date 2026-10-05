import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { ChatParticipant, ForwardedComment } from '@/api/chats';
import { CommentForwardLead } from '@/features/chats/CommentForwardLead';
import { MessageBubble } from '@/features/chats/MessageBubble';
import {
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

const noop = () => undefined;

type Options = {
  chatId: string;
  currentUserId: string | null;
  isMember: boolean;
  /** До какого момента этот чат прочитали остальные. */
  readUpTo: string | null;
  participantsById: ReadonlyMap<string, ChatParticipant>;
  mediaBounds: MosaicBounds;
  retry: (localId: string) => void;
  openPerson: (personId: string) => void;
  navigation: QuoteNavigation;
  reactions: ReactToMessage;
  /**
   * Аватары у чужих облачков. В личном диалоге их нет вовсе — и у облачков
   * островка тоже, даже если автор оригинала третий человек: его видно по
   * строке имени, а ряд облачков не пляшет по ширине.
   */
  showAvatars: boolean;
  /** Тап по сниппету пересланного комментария — к нему в его ветке. */
  openForwardedComment: (comment: ForwardedComment) => void;
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
  readUpTo,
  participantsById,
  mediaBounds,
  retry,
  openPerson,
  navigation,
  reactions,
  showAvatars,
  openForwardedComment,
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
  const reactToComment = useCallback(
    (comment: ForwardedComment, emoji: string) =>
      sendReaction(
        queryClient,
        comment.id,
        {
          emoji: nextReaction(comment.reactions.mine, emoji),
          audience: audienceOf(comment.chat?.amMember ?? false),
        },
        'comment',
      ),
    [queryClient],
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
          isRead={readUpTo !== null && item.createdAt <= readUpTo}
          authorName={author?.displayName ?? DELETED_ACCOUNT}
          authorAvatarUrl={author?.avatarUrl ?? null}
          mediaBounds={mediaBounds}
          onRetry={retry}
          onAuthorPress={interactive && item.authorId ? () => openPerson(item.authorId!) : undefined}
          reactionAudience={audienceOf(comment?.chat?.amMember ?? false)}
          onReactionToggle={
            interactive && comment && item.status === 'sent'
              ? (emoji) => reactToComment(comment, emoji)
              : undefined
          }
          showAvatar={showAvatars}
          lead={
            <CommentForwardLead
              forward={forward}
              isOwn={item.authorId === currentUserId}
              onOpenSource={interactive && comment ? () => openForwardedComment(comment) : undefined}
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
      readUpTo,
      retry,
      showAvatars,
    ],
  );

  const messageBubble = useCallback(
    (item: ChatMessage, interactive: boolean, rowKey: string) => {
      if (item.kind === 'comment_forward') return commentForwardBubble(item, interactive);

      const { authorId } = item;
      const author = authorId ? participantsById.get(authorId) : undefined;

      return (
        <MessageBubble
          message={item}
          isOwn={item.authorId === currentUserId}
          isRead={readUpTo !== null && item.createdAt <= readUpTo}
          authorName={author?.displayName ?? DELETED_ACCOUNT}
          authorAvatarUrl={author?.avatarUrl ?? null}
          mediaBounds={mediaBounds}
          onRetry={retry}
          onAuthorPress={interactive && authorId ? () => openPerson(authorId) : undefined}
          onQuotePress={interactive ? openQuote : undefined}
          reactionAudience={myAudience}
          onReactionToggle={
            interactive && canReactTo(item) ? (emoji) => toggle(item, emoji) : undefined
          }
          comments={commentsEntry(item, chatId, interactive, isMember, rowKey)}
          showAvatar={showAvatars}
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
      readUpTo,
      retry,
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
      const inThisChat = original.chatId === chatId;
      // «Прочитано» у своего — по прочтению чата оригинала.
      const originRead = inThisChat ? readUpTo : (original.chat?.readUpTo ?? null);
      const audience = audienceFor(row);
      const fromHeaderChat = original.chatId === row.island.forward?.sourceChat?.id;

      return (
        <MessageBubble
          message={message}
          isOwn={authorId === currentUserId}
          isRead={originRead !== null && message.createdAt <= originRead}
          authorName={original.authorName ?? DELETED_ACCOUNT}
          authorAvatarUrl={original.authorAvatarUrl}
          mediaBounds={mediaBounds}
          onRetry={noop}
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
          // Комментарии — к оригиналу: панель открывается на него, из его чата.
          comments={commentsEntry(
            message,
            original.chatId,
            interactive,
            inThisChat ? isMember : (original.chat?.amMember ?? false),
            row.key,
          )}
          showAvatar={showAvatars}
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
      readUpTo,
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
