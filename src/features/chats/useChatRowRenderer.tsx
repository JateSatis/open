import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { DeletedOriginal } from '@/features/chats/DeletedOriginal';
import { IslandBorder } from '@/features/chats/IslandBorder';
import { IslandHeader } from '@/features/chats/IslandHeader';
import {
  contentOf,
  type BubbleRow,
  type ChatListRow,
  type IslandHeaderRow,
} from '@/features/chats/islands/rows';
import { isLocalMessage } from '@/features/chats/messageActions';
import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { MessageRow } from '@/features/chats/MessageRow';
import { SystemMessage } from '@/features/chats/SystemMessage';
import type { JumpHighlight } from '@/features/chats/useJumpToMessage';
import { isSelectableRow } from '@/features/chats/useMessageSelection';
import { Spacing } from '@/theme';

const noop = () => undefined;

type Options = {
  currentUserId: string | null;
  isMember: boolean;
  isSelecting: boolean;
  isSelected: (rowKey: string) => boolean;
  toggleSelected: (rowKey: string) => void;
  /** Строка, чьё сообщение сейчас правится. */
  editingId: string | null;
  highlight: JumpHighlight | null;
  bubbleFor: (row: BubbleRow, interactive: boolean) => React.ReactElement | null;
  openMenu: (row: ChatListRow, anchor: AnchorRect) => void;
  startReply: (rows: BubbleRow[]) => void;
  retry: (localId: string) => void;
  openChat: (chatId: string) => void;
  hostName: (authorId: string | null) => string;
};

/**
 * Строки переписки: обычное сообщение, системное, плашка островка и облачко
 * островка. Островок рисуется кусками рамки по строкам (`IslandBorder`) —
 * облачка внутри те же, что везде, со своим выбором, меню и свайпом ответа.
 */
export function useChatRowRenderer({
  currentUserId,
  isMember,
  isSelecting,
  isSelected,
  toggleSelected,
  editingId,
  highlight,
  bubbleFor,
  openMenu,
  startReply,
  retry,
  openChat,
  hostName,
}: Options) {
  /** Плашка островка — и в строке, и копией в меню. */
  const islandHeader = useCallback(
    (row: IslandHeaderRow, interactive: boolean) => {
      const { island } = row;
      const sourceChat = island.forward?.sourceChat ?? null;

      return (
        <IslandHeader
          sourceName={sourceChat?.name ?? null}
          status={island.status}
          onPress={interactive && sourceChat ? () => openChat(sourceChat.id) : undefined}
          onRetry={interactive && island.localId ? () => retry(island.localId!) : undefined}
        />
      );
    },
    [openChat, retry],
  );

  const renderItem = useCallback(
    ({ item: row }: { item: ChatListRow }) => {
      const highlightKey = highlight?.messageId === row.key ? highlight.key : null;

      if (row.type === 'island-header') {
        return (
          <MessageRow
            selectionMode={isSelecting}
            selectable={false}
            selected={false}
            highlightKey={highlightKey}
            messageId={row.key}
            onLongPress={(anchor) => openMenu(row, anchor)}
            onToggle={noop}
            frame={<IslandBorder top bottom={false} />}
          >
            {islandHeader(row, true)}
          </MessageRow>
        );
      }

      if (row.type === 'message' && row.message.kind === 'system') {
        const { message } = row;

        // Системное — не чья-то реплика: без меню, выбора и ответа свайпом.
        return (
          <SystemMessage
            message={message}
            currentUserId={currentUserId}
            isMember={isMember}
            hostName={hostName(message.call?.hostId ?? null)}
          />
        );
      }

      const content = contentOf(row);
      const local = row.type === 'message' ? isLocalMessage(row.message) : isLocalMessage(row.island);
      const island = row.type === 'island-item' ? row : null;
      // Заглушке удалённого меню нужно только переславшему — убрать её.
      const hasMenu = content !== null || island?.island.authorId === currentUserId;

      return (
        <MessageRow
          selectionMode={isSelecting}
          selectable={isSelectableRow(row, currentUserId)}
          selected={isSelected(row.key)}
          editing={row.key === editingId}
          highlightKey={highlightKey}
          messageId={row.key}
          onLongPress={hasMenu ? (anchor) => openMenu(row, anchor) : noop}
          onToggle={() => toggleSelected(row.key)}
          // Ответ — это отправка: свайп есть только у участника и только у
          // сообщений, которые уже на сервере.
          onSwipeReply={isMember && content && !local ? () => startReply([row]) : undefined}
          frame={island ? <IslandBorder top={false} bottom={island.isLast} /> : undefined}
        >
          {island ? (
            <View style={island.isLast ? styles.lastInIsland : undefined}>
              {content ? bubbleFor(row, true) : <DeletedOriginal />}
            </View>
          ) : (
            bubbleFor(row, true)
          )}
        </MessageRow>
      );
    },
    [
      bubbleFor,
      currentUserId,
      editingId,
      highlight,
      hostName,
      isMember,
      isSelected,
      isSelecting,
      islandHeader,
      openMenu,
      startReply,
      toggleSelected,
    ],
  );

  return { renderItem, islandHeader };
}

const styles = StyleSheet.create({
  /** Под последним облачком — низ рамки и зазор до следующего сообщения. */
  lastInIsland: {
    paddingBottom: Spacing.two,
  },
});
