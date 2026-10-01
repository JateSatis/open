import { useCallback, type ReactNode, type Ref } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { isLocalMessage } from '@/features/chats/messageActions';
import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { MessageRow } from '@/features/chats/MessageRow';
import type { CommentItem } from '@/features/interactions/comments/commentItem';

/** Прыжок к комментарию: он и ключ вспышки — новый на каждый прыжок. */
export type CommentHighlight = { id: string; key: number };

export type CommentListProps = {
  listRef: Ref<FlatList<CommentItem>>;
  comments: CommentItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  editingId: string | null;
  /** Сообщение удалено — новых не будет, и пустое состояние этого не обещает. */
  closed: boolean;
  loadMore: () => void;
  /** Тап по облачку — меню. */
  onOpenMenu: (comment: CommentItem, anchor: AnchorRect) => void;
  /** Свайп влево — ответить. Нет — у удалённого сообщения ответов не принимают. */
  onSwipeReply?: (comment: CommentItem) => void;
  /** Выбор, как в переписке: долгое нажатие начинает его, тап переключает отметку. */
  selection: {
    isActive: boolean;
    isSelected: (id: string) => boolean;
    start: (id: string) => void;
    toggle: (id: string) => void;
  };
  highlight: CommentHighlight | null;
  /** Облачко комментария — то же, что у сообщения в переписке. */
  renderBubble: (comment: CommentItem) => ReactNode;
};

/**
 * Комментарии в виде чата: свои справа, новые внизу. Список перевёрнут и
 * постраничен, как переписка: открывается у последних, листание вверх
 * догружает старые. Жесты строки — те же, что в переписке.
 */
export function CommentList({
  listRef,
  comments,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  editingId,
  closed,
  loadMore,
  onOpenMenu,
  onSwipeReply,
  selection,
  highlight,
  renderBubble,
}: CommentListProps) {
  const renderItem = useCallback(
    ({ item }: { item: CommentItem }) => {
      const selectable = !isLocalMessage(item);

      return (
        <MessageRow
          selectionMode={selection.isActive}
          selectable={selectable}
          selected={selection.isSelected(item.id)}
          editing={item.id === editingId}
          highlightKey={highlight?.id === item.id ? highlight.key : null}
          messageId={item.id}
          onOpenMenu={(anchor) => onOpenMenu(item, anchor)}
          onSelect={selectable ? () => selection.start(item.id) : undefined}
          onToggle={() => selection.toggle(item.id)}
          onSwipeReply={onSwipeReply && selectable ? () => onSwipeReply(item) : undefined}
        >
          {renderBubble(item)}
        </MessageRow>
      );
    },
    [editingId, highlight, onOpenMenu, onSwipeReply, renderBubble, selection],
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Загрузка комментариев" />
      </View>
    );
  }

  if (comments.length === 0) {
    return (
      <View style={styles.centered}>
        <Text color={error ? 'danger' : 'textSecondary'} style={styles.emptyText}>
          {error ??
            (closed
              ? 'Комментариев нет.'
              : 'Комментариев пока нет. Их увидит каждый, кто откроет этот чат.')}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      testID="comments-list"
      inverted
      data={comments}
      keyExtractor={(comment) => comment.id}
      renderItem={renderItem}
      extraData={selection}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      onEndReached={hasMore ? loadMore : undefined}
      onEndReachedThreshold={0.4}
      // Строки разной высоты: до незамеренной сначала грубо, по средней
      // высоте, потом точно — как прыжок к сообщению в переписке.
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        const list = listRef && 'current' in listRef ? listRef.current : null;

        list?.scrollToOffset({ offset: averageItemLength * index, animated: false });
        requestAnimationFrame(() =>
          list?.scrollToIndex({ index, viewPosition: 0.5, animated: true }),
        );
      }}
      ListFooterComponent={
        isLoadingMore ? <ActivityIndicator accessibilityLabel="Загрузка комментариев" /> : null
      }
    />
  );
}
