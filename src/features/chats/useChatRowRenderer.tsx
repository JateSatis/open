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
  type IslandItemRow,
  toChatRows,
} from '@/features/chats/islands/rows';
import type { RowPoint } from '@/features/chats/fragments/fragmentSelection';
import { isLocalMessage } from '@/features/chats/messageActions';
import type { MenuAnchor } from '@/features/chats/MessageContextMenu';
import { MessageRow } from '@/features/chats/MessageRow';
import { SystemMessage } from '@/features/chats/SystemMessage';
import { isSelectableRow } from '@/features/chats/useMessageSelection';
import { Spacing } from '@/theme';

type Options = {
  currentUserId: string | null;
  isMember: boolean;
  isSelecting: boolean;
  isSelected: (rowKey: string) => boolean;
  toggleSelected: (rowKey: string) => void;
  /** Строка, чьё сообщение сейчас правится. */
  editingId: string | null;
  bubbleFor: (row: BubbleRow, interactive: boolean) => React.ReactElement | null;
  openMenu: (row: ChatListRow, anchor: MenuAnchor) => void;
  startReply: (rows: BubbleRow[]) => void;
  /** Свайп влево отвечает. В постах канала его нет: там свайп листает разделы. */
  swipeReply?: boolean;
  /** Тап по облачку — режим фрагментов. */
  pressRow?: (row: BubbleRow) => void;
  /** Долгое нажатие в режиме фрагментов — выделение текста, если палец на нём. */
  longPressAt?: (rowKey: string, point: RowPoint) => boolean | Promise<boolean>;
  retry: (localId: string) => void;
  hostName: (authorId: string | null) => string;
};

/** Облачки островка, которые можно выбрать. */
function selectableItems(island: IslandHeaderRow['island'], currentUserId: string | null) {
  return toChatRows([island]).filter(
    (row): row is IslandItemRow =>
      row.type === 'island-item' && isSelectableRow(row, currentUserId),
  );
}

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
  bubbleFor,
  openMenu,
  startReply,
  swipeReply = true,
  pressRow,
  longPressAt,
  retry,
  hostName,
}: Options) {
  /**
   * Плашка островка — и в строке, и копией в меню. Тап по ней — исходный
   * чат; долгое нажатие — меню островка, как у облачка.
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

  // В выборе тап по плашке отмечает островок целиком, а если он уже отмечен
  // весь — снимает отметку.
  const toggleIsland = useCallback(
    (island: IslandHeaderRow['island']) => {
      const items = selectableItems(island, currentUserId);
      const target = !items.every((item) => isSelected(item.key));

      for (const item of items) {
        if (isSelected(item.key) !== target) toggleSelected(item.key);
      }
    },
    [currentUserId, isSelected, toggleSelected],
  );

  /** Содержимое строки облачка; у последнего в островке — отступ снизу. */
  const bubbleContent = useCallback(
    (row: BubbleRow, interactive: boolean) =>
      row.type === 'island-item' ? (
        <View style={row.isLast ? styles.lastInIsland : undefined}>
          {contentOf(row) ? bubbleFor(row, interactive) : <DeletedOriginal />}
        </View>
      ) : (
        bubbleFor(row, interactive)
      ),
    [bubbleFor],
  );

  const renderItem = useCallback(
    ({ item: row }: { item: ChatListRow }) => {

      if (row.type === 'island-header') {
        const headerItems = isSelecting ? selectableItems(row.island, currentUserId) : [];

        return (
          <MessageRow
            selectionMode={isSelecting}
            selectable={isSelecting && headerItems.length > 0}
            // Кружок плашки — «островок отмечен целиком».
            selected={
              isSelecting &&
              headerItems.length > 0 &&
              headerItems.every((item) => isSelected(item.key))
            }
            messageId={row.key}
            onOpenMenu={(anchor) => openMenu(row, anchor)}
            onToggle={() => toggleIsland(row.island)}
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
      const local =
        row.type === 'message' ? isLocalMessage(row.message) : isLocalMessage(row.island);
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
          messageId={row.key}
          onOpenMenu={hasMenu ? (anchor) => openMenu(row, anchor) : undefined}
          onPress={pressRow && content ? () => pressRow(row) : undefined}
          onLongPressAt={longPressAt ? (point) => longPressAt(row.key, point) : undefined}
          onToggle={() => toggleSelected(row.key)}
          // Ответ — это отправка: свайп есть только у участника и только у
          // сообщений, которые уже на сервере.
          onSwipeReply={
            swipeReply && isMember && content && !local ? () => startReply([row]) : undefined
          }
          frame={island ? <IslandBorder top={false} bottom={island.isLast} /> : undefined}
        >
          {bubbleContent(row, true)}
        </MessageRow>
      );
    },
    [
      bubbleContent,
      currentUserId,
      editingId,
          hostName,
      isMember,
      isSelected,
      isSelecting,
      islandHeader,
      longPressAt,
      openMenu,
      pressRow,
      startReply,
      swipeReply,
      toggleIsland,
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
