import { useCallback, useMemo, type ComponentType, type ReactNode } from 'react';
import { FlatList, View, useWindowDimensions, type FlatListProps, type ListRenderItem } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { MediaGridItem } from '@/features/media/MediaGridItem';
import { cachedAssetUri } from '@/features/media/assetUriCache';
import { MediaLimits } from '@/features/media/constants';
import type { LibraryAsset, MediaLibraryItem } from '@/features/media/mediaLibrary';
import { useRecentMedia } from '@/features/media/useRecentMedia';
import { Spacing } from '@/theme';

const COLUMNS = 3;
const GAP = Spacing.half;

/**
 * Следующая страница запрашивается за два экрана до конца списка: на быстром
 * скролле пользователь не должен упираться в пустоту и ждать ответа
 * медиатеки.
 */
const END_REACHED_THRESHOLD = 2;
/** Клеток в первом кадре — с запасом на высокий экран, чтобы грид открылся заполненным. */
const INITIAL_ROWS = 8;
/** Сколько строк грид дорисовывает за один проход — иначе скролл опережает отрисовку. */
const ROWS_PER_BATCH = 6;

/**
 * Минимальный набор пропов, которым пользуется грид — им отвечает и обычный
 * `FlatList`, и `Animated.FlatList`. Снаружи решают, какой список
 * подставить: внутри шита выбора медиа список должен быть частью жеста
 * самого шита, поэтому шит подставляет свой, обёрнутый в `GestureDetector`.
 */
export type MediaListComponent = ComponentType<
  Pick<
    FlatListProps<MediaLibraryItem>,
    | 'testID'
    | 'data'
    | 'numColumns'
    | 'keyExtractor'
    | 'contentContainerStyle'
    | 'columnWrapperStyle'
    | 'onEndReached'
    | 'onEndReachedThreshold'
    | 'renderItem'
    | 'getItemLayout'
    | 'initialNumToRender'
    | 'maxToRenderPerBatch'
    | 'ListEmptyComponent'
    | 'ListFooterComponent'
  >
>;

export type MediaGridProps = {
  /** Порядок = порядок выбора, а не порядок в галерее — так строится нумерация кружков. */
  selected: LibraryAsset[];
  onToggle: (asset: LibraryAsset) => void;
  ListComponent?: MediaListComponent;
  /**
   * Хвост списка, который задаёт владелец грида: место под тем, что
   * перекрывает грид снизу. Внутри шита это не константа — нижний край
   * списка уезжает за экран вместе с самим шитом, и свободного места под
   * последней строкой нужно ровно столько, насколько шит опущен.
   */
  footerSpace?: ReactNode;
};

/**
 * Грид последних фото и видео устройства. Максимально простой по задаче:
 * без альбомов, без предпросмотра — только выбор через кружок в углу
 * клетки.
 */
export function MediaGrid({
  selected,
  onToggle,
  ListComponent = FlatList,
  footerSpace = null,
}: MediaGridProps) {
  const { width } = useWindowDimensions();
  const { status, items, isLoadingMore, hasMore, loadMore, requestAccess } = useRecentMedia();

  const cellSize = (width - GAP * (COLUMNS + 1)) / COLUMNS;
  const rowHeight = cellSize + GAP;
  const selectedIds = useMemo(
    () => new Map(selected.map((asset, index) => [asset.id, index + 1])),
    [selected],
  );
  const isFull = selected.length >= MediaLimits.gallery.maxSelection;

  // Стабильный между рендерами: клетка отдаёт наверх свой же `asset`, и
  // `memo` на ней не ломается от новой стрелки на каждый рендер грида.
  const handleToggle = useCallback(
    (item: MediaLibraryItem) => {
      // Путь к файлу берётся из кэша, если он уже прогрет, и не резолвится
      // синхронно: выбор — операция на один тап, ждать файловую систему
      // в ней нечего. Недостающий путь добирается к отправке.
      onToggle({ ...item, uri: cachedAssetUri(item.id) });
    },
    [onToggle],
  );

  const renderItem = useCallback<ListRenderItem<MediaLibraryItem>>(
    ({ item }) => {
      const selectionOrder = selectedIds.get(item.id) ?? null;

      return (
        <MediaGridItem
          asset={item}
          size={cellSize}
          selectionOrder={selectionOrder}
          disabled={isFull && selectionOrder === null}
          onToggle={handleToggle}
        />
      );
    },
    [cellSize, handleToggle, isFull, selectedIds],
  );

  // Клетки квадратные и одного размера, значит положение любой строки
  // известно заранее — списку не нужно её измерять, чтобы отрисовать.
  const getItemLayout = useCallback(
    (_: ArrayLike<MediaLibraryItem> | null | undefined, index: number) => ({
      length: rowHeight,
      offset: GAP + rowHeight * Math.floor(index / COLUMNS),
      index,
    }),
    [rowHeight],
  );

  if (status === 'denied') {
    return (
      <View style={styles.notice}>
        <Text color="textSecondary" style={styles.noticeText}>
          Open не может показать фото и видео без доступа к галерее.
        </Text>
        <Button label="Разрешить доступ" size="sm" onPress={requestAccess} />
      </View>
    );
  }

  const List = ListComponent;

  return (
    <List
      testID="media-grid"
      data={items}
      numColumns={COLUMNS}
      keyExtractor={(asset) => asset.id}
      contentContainerStyle={styles.content}
      columnWrapperStyle={styles.row}
      onEndReached={hasMore ? loadMore : undefined}
      onEndReachedThreshold={END_REACHED_THRESHOLD}
      getItemLayout={getItemLayout}
      initialNumToRender={COLUMNS * INITIAL_ROWS}
      maxToRenderPerBatch={COLUMNS * ROWS_PER_BATCH}
      renderItem={renderItem}
      ListEmptyComponent={
        status === 'checking' ? null : (
          <View style={styles.notice}>
            <Text color="textSecondary">На устройстве нет фото и видео.</Text>
          </View>
        )
      }
      ListFooterComponent={
        <>
          {isLoadingMore ? <View style={styles.footerSpace} /> : null}
          {footerSpace}
        </>
      }
    />
  );
}
