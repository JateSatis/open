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
  /** Долгое нажатие — выбор с этим облачком уже отмеченным. */
  startSelection: (rowKey: string) => void;
  /** Долгое нажатие на плашку островка — отмечены все его облачка. */
  selectIsland: (island: IslandHeaderRow['island']) => void;
  /** Строка, чьё сообщение сейчас правится. */
  editingId: string | null;
  highlight: JumpHighlight | null;
  bubbleFor: (row: BubbleRow, interactive: boolean) => React.ReactElement | null;
  openMenu: (row: ChatListRow, anchor: AnchorRect) => void;
  startReply: (rows: BubbleRow[]) => void;
  retry: (localId: string) => void;
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
  startSelection,
  selectIsland,
  editingId,
  highlight,
  bubbleFor,
  openMenu,
  startReply,
  retry,
  hostName,
}: Options) {
  /**
   * Плашка островка — и в строке, и копией в меню. Тап по ней — меню
   * островка, как у облачка; переход в исходный чат — его первый пункт.
   */
  const islandHeader = useCallback(
    (row: IslandHeaderRow, interactive: boolean) => {
      const { island } = row;

      return (
        <IslandHeader
          sourceName={island.forward?.sourceChat?.name ?? null}
          status={island.status}
          onRetry={interactive && island.localId ? () => retry(island.localId!) : undefined}
        />
      );
    },
    [retry],
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
            onOpenMenu={(anchor) => openMenu(row, anchor)}
            onSelect={isLocalMessage(row.island) ? undefined : () => selectIsland(row.island)}
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
      const selectable = isSelectableRow(row, currentUserId);

      return (
        <MessageRow
          selectionMode={isSelecting}
          selectable={selectable}
          selected={isSelected(row.key)}
          editing={row.key === editingId}
          highlightKey={highlightKey}
          messageId={row.key}
          onOpenMenu={hasMenu ? (anchor) => openMenu(row, anchor) : undefined}
          onSelect={selectable ? () => startSelection(row.key) : undefined}
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
      selectIsland,
      startReply,
      startSelection,
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
