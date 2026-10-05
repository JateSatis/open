import type { FlashListRef, ListRenderItem } from '@shopify/flash-list';
import { useCallback, useMemo, type RefObject } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { CommentRow } from './rows';
import { CommentsSheetList } from './SheetList';
import { styles } from './styles';

import { Text } from '@/components/Text';

/** Прыжок к комментарию: он и ключ вспышки — новый на каждый прыжок. */
export type CommentHighlight = { id: string; key: number };

export type CommentListProps = {
  listRef: RefObject<FlashListRef<CommentRow> | null>;
  rows: CommentRow[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /** Сообщение удалено — новых не будет, и пустое состояние этого не обещает. */
  closed: boolean;
  loadMore: () => void;
  /** Место под шапкой шита в начале содержимого. */
  headerSpace: number;
  /** Место под строкой ввода и клавиатурой в конце содержимого. */
  footerSpace: number;
  renderRow: ListRenderItem<CommentRow>;
  /** Меняется, когда строкам нужно перерисоваться без смены данных: выбор, правка, вспышка. */
  extraData: unknown;
  /** Раскладка списка зафиксирована — по ней меряется раскрытый тред. */
  onCommitLayout: () => void;
};

const keyOf = (row: CommentRow) => row.key;
const typeOf = (row: CommentRow) =>
  row.type === 'comment' ? (row.comment.threadRootId ? 'reply' : 'root') : row.type;

/**
 * Комментарии списком сверху вниз: верх по рангу, раскрытый тред — под своим
 * корнем. Постранично: листание вниз догружает следующую страницу верха.
 * Список живёт внутри шита — его скролл и есть движение шита.
 */
export function CommentList({
  listRef,
  rows,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  closed,
  loadMore,
  headerSpace,
  footerSpace,
  renderRow,
  extraData,
  onCommitLayout,
}: CommentListProps) {
  // Шапка и хвост мемоизированы: `FlashList` сравнивает их по ссылке.
  const header = useMemo(
    () => (
      <View style={{ height: headerSpace }}>
        <View style={styles.listTop} />
      </View>
    ),
    [headerSpace],
  );

  const footer = useMemo(
    () => (
      <View style={{ minHeight: footerSpace }}>
        {isLoadingMore ? <ActivityIndicator accessibilityLabel="Загрузка комментариев" /> : null}
      </View>
    ),
    [footerSpace, isLoadingMore],
  );

  const empty = useMemo(
    () =>
      isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator accessibilityLabel="Загрузка комментариев" />
        </View>
      ) : (
        <View style={styles.centered}>
          <Text color={error ? 'danger' : 'textSecondary'} style={styles.emptyText}>
            {error ??
              (closed
                ? 'Комментариев нет.'
                : 'Комментариев пока нет. Их увидит каждый, кто откроет этот чат.')}
          </Text>
        </View>
      ),
    [closed, error, isLoading],
  );

  const onEndReached = useCallback(() => {
    if (hasMore) loadMore();
  }, [hasMore, loadMore]);

  return (
    <CommentsSheetList
      listRef={listRef}
      testID="comments-list"
      data={rows}
      keyExtractor={keyOf}
      getItemType={typeOf}
      renderItem={renderRow}
      extraData={extraData}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={empty}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      onCommitLayoutEffect={onCommitLayout}
    />
  );
}
