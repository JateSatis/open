import type { FlashListRef, ListRenderItem, ViewToken } from '@shopify/flash-list';
import { useCallback, useMemo, type RefObject } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { CommentRow } from './rows';
import { CommentsSheetList } from './SheetList';
import { styles } from './styles';

import { Text } from '@/components/Text';
import { commentsShown } from '@/features/recs/journal/commentsJournal';

/** Прыжок к комментарию: он и ключ вспышки — новый на каждый прыжок. */
export type CommentHighlight = { id: string; key: number };

export type CommentListProps = {
  testID: string;
  listRef: RefObject<FlashListRef<CommentRow> | null>;
  rows: CommentRow[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /** Сообщение удалено — новых не будет, и пустое состояние этого не обещает. */
  closed: boolean;
  /** Пустому списку нечего сказать — окно треда, пока тред не открыт. */
  silentWhenEmpty?: boolean;
  loadMore: () => void;
  /** Место под шапкой шита в начале содержимого. */
  headerSpace: number;
  /** Место под строкой ввода и клавиатурой в конце содержимого. */
  footerSpace: number;
  renderRow: ListRenderItem<CommentRow>;
  /** Меняется, когда строкам нужно перерисоваться без смены данных: выбор, правка, вспышка. */
  extraData: unknown;
};

const keyOf = (row: CommentRow) => row.key;

/** Комментарий засчитан показанным, когда на экране хотя бы половина строки. */
const VIEWABILITY = { itemVisiblePercentThreshold: 50 };
const typeOf = (row: CommentRow) =>
  row.type === 'comment' ? (row.threadRoot ? 'thread-root' : 'comment') : row.type;

/**
 * Комментарии списком сверху вниз — верх по рангу или окно треда.
 * Постранично: листание вниз догружает следующую страницу верха.
 * Список живёт внутри шита — его скролл и есть движение шита.
 */
export function CommentList({
  testID,
  listRef,
  rows,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  closed,
  silentWhenEmpty = false,
  loadMore,
  headerSpace,
  footerSpace,
  renderRow,
  extraData,
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

  // Журнал: что из комментариев действительно показалось на экране.
  const pane = testID === 'comments-thread-list' ? 'thread' : 'main';
  const onViewableItemsChanged = useCallback(
    ({ changed }: { changed: ViewToken<CommentRow>[] }) => {
      const shown = changed.flatMap(({ item, index, isViewable }) =>
        isViewable && item.type === 'comment'
          ? [
              {
                id: item.comment.id,
                index: index ?? 0,
                pinned: item.pinned,
                threadRoot: item.threadRoot,
              },
            ]
          : [],
      );

      if (shown.length > 0) commentsShown(shown, pane);
    },
    [pane],
  );

  const onEndReached = useCallback(() => {
    if (hasMore) loadMore();
  }, [hasMore, loadMore]);

  return (
    <CommentsSheetList
      listRef={listRef}
      testID={testID}
      data={rows}
      keyExtractor={keyOf}
      getItemType={typeOf}
      renderItem={renderRow}
      extraData={extraData}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={silentWhenEmpty ? null : empty}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      viewabilityConfig={VIEWABILITY}
      onViewableItemsChanged={onViewableItemsChanged}
    />
  );
}
