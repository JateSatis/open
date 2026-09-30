import { useCallback, type ReactNode, type Ref } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { MessageRow } from '@/features/chats/MessageRow';
import type { CommentItem } from '@/features/interactions/comments/commentItem';

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
  onLongPress: (comment: CommentItem, anchor: AnchorRect) => void;
  /** Облачко комментария — то же, что у сообщения в переписке. */
  renderBubble: (comment: CommentItem) => ReactNode;
};

const noop = () => undefined;

/**
 * Комментарии в виде чата: свои справа, новые внизу. Список перевёрнут и
 * постраничен, как переписка: открывается у последних, листание вверх
 * догружает старые.
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
  onLongPress,
  renderBubble,
}: CommentListProps) {
  const renderItem = useCallback(
    ({ item }: { item: CommentItem }) => (
      <MessageRow
        selectionMode={false}
        selectable={false}
        selected={false}
        editing={item.id === editingId}
        highlightKey={null}
        messageId={item.id}
        onLongPress={(anchor) => onLongPress(item, anchor)}
        onToggle={noop}
      >
        {renderBubble(item)}
      </MessageRow>
    ),
    [editingId, onLongPress, renderBubble],
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
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      onEndReached={hasMore ? loadMore : undefined}
      onEndReachedThreshold={0.4}
      ListFooterComponent={
        isLoadingMore ? <ActivityIndicator accessibilityLabel="Загрузка комментариев" /> : null
      }
    />
  );
}
