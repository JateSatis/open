import { useCallback } from 'react';

import type { ChatParticipant } from '@/api/chats';
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
import { audienceOf } from '@/features/interactions/reactionState';
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
};

/** Облачко и то, в какой ряд в нём лягут мои реакции. */
export type ChatBubbles = {
  /** Облачко строки; `interactive: false` — копия в меню: ничего не нажимается. */
  bubbleFor: (row: BubbleRow, interactive: boolean) => React.ReactElement | null;
  /** Ряд моей реакции на облачко: у облачка островка — по участию в чате оригинала. */
  audienceFor: (row: BubbleRow) => ReactionAudience;
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
}: Options): ChatBubbles {
  const { openQuote, openOriginal } = navigation;
  const { audience: myAudience, toggle } = reactions;

  const audienceFor = useCallback(
    (row: BubbleRow): ReactionAudience => {
      const original = row.type === 'island-item' ? row.item.original : null;

      // База решает ряд по участию в чате оригинала; это — её же правило.
      if (!original || original.chatId === chatId) return myAudience;

      return audienceOf(original.chat?.amMember ?? false);
    },
    [chatId, myAudience],
  );

  const messageBubble = useCallback(
    (item: ChatMessage, interactive: boolean) => {
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
          onQuotePress={interactive ? () => openQuote(item) : undefined}
          reactionAudience={myAudience}
          onReactionToggle={
            interactive && canReactTo(item) ? (emoji) => toggle(item, emoji) : undefined
          }
          comments={commentsEntry(item, chatId, interactive)}
        />
      );
    },
    [
      chatId,
      currentUserId,
      mediaBounds,
      myAudience,
      openPerson,
      openQuote,
      participantsById,
      readUpTo,
      retry,
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
          onQuotePress={interactive ? () => openQuote(message, original.chatId) : undefined}
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
          comments={commentsEntry(message, original.chatId, interactive)}
        />
      );
    },
    [
      audienceFor,
      chatId,
      currentUserId,
      mediaBounds,
      openOriginal,
      openPerson,
      openQuote,
      readUpTo,
      toggle,
    ],
  );

  const bubbleFor = useCallback(
    (row: BubbleRow, interactive: boolean) =>
      row.type === 'message' ? messageBubble(row.message, interactive) : islandBubble(row, interactive),
    [islandBubble, messageBubble],
  );

  return { bubbleFor, audienceFor };
}
