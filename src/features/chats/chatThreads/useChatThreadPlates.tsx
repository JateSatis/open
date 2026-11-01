import { useCallback, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';

import { openChatThread } from '@/features/chats/chatThreads/chatThreadPanelStore';
import { useChatThreadSummaries } from '@/features/chats/chatThreads/summaries';
import { ChatThreadPlate } from '@/features/chats/ChatThreadPlate';
import { DeletedOriginal } from '@/features/chats/DeletedOriginal';
import type { ChatListRow } from '@/features/chats/islands/rows';
import { BUBBLE_AVATAR, BUBBLE_ROW_GAP } from '@/features/chats/MessageBubble/layout';
import type { ChatMessage } from '@/features/chats/messages/types';
import { PENDING_SEQ } from '@/api/pendingSeq';
import { Sizes } from '@/theme';

type Options = {
  chatId: string;
  /** Открыт вид «Треды». В обычном виде строки рисуются как есть. */
  active: boolean;
  messages: ChatMessage[];
  currentUserId: string | null;
  /** У чужих облачков — аватар: плашка встаёт под облачко, а не под аватар. */
  showAvatars: boolean;
  renderItem: (info: { item: ChatListRow }) => ReactElement | null;
};

/**
 * Строки ленты «Тредов»: облачко как обычно, а под исходным сообщением —
 * плашка его треда. Удалённое исходное с ответами — заглушка «Сообщение
 * удалено» с плашкой.
 */
export function useChatThreadPlates({
  chatId,
  active,
  messages,
  currentUserId,
  showAvatars,
  renderItem,
}: Options) {
  const rootIds = useMemo(
    () =>
      active
        ? messages
            .filter((message) => message.seq < PENDING_SEQ && message.kind !== 'system')
            .map((message) => message.id)
        : [],
    [active, messages],
  );
  const summaries = useChatThreadSummaries(chatId, rootIds, active);
  const inset = showAvatars ? BUBBLE_AVATAR + BUBBLE_ROW_GAP : 0;
  const aside = Sizes.commentsCircle + BUBBLE_ROW_GAP;

  const render = useCallback(
    (info: { item: ChatListRow }) => {
      const row = info.item;
      const summary = row.type === 'message' ? summaries[row.message.id] : null;

      if (row.type !== 'message' || (!summary && !row.message.chatThreadDeletedRoot)) {
        return renderItem(info);
      }

      const { message } = row;
      const plate = summary ? (
        <ChatThreadPlate
          summary={summary}
          isOwn={message.authorId === currentUserId}
          inset={inset}
          aside={aside}
          onPress={() => openChatThread({ chatId, rootId: message.id })}
        />
      ) : null;

      if (message.chatThreadDeletedRoot) {
        // Без видимых ответов удалённое не показывается.
        if (!summary) return null;

        return (
          <View testID={`chat-thread-deleted-root-${message.id}`}>
            <DeletedOriginal />
            {plate}
          </View>
        );
      }

      return (
        <View>
          {renderItem(info)}
          {plate}
        </View>
      );
    },
    [aside, chatId, currentUserId, inset, renderItem, summaries],
  );

  return { renderItem: active ? render : renderItem, summaries };
}
