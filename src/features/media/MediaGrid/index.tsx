import { FlatList, View, useWindowDimensions, type FlatListProps, type ListRenderItem } from 'react-native';
import { useCallback, useMemo, type ComponentType } from 'react';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { MediaGridItem } from '@/features/media/MediaGridItem';
import { MediaLimits } from '@/features/media/constants';
import type { LibraryAsset, MediaLibraryItem } from '@/features/media/mediaLibrary';
import { useRecentMedia } from '@/features/media/useRecentMedia';
import { Spacing } from '@/theme';

const COLUMNS = 3;
const GAP = Spacing.half;

/**
 * Минимальный набор пропов, которым пользуется грид — им отвечает и обычный
 * `FlatList`, и `BottomSheetFlatList` из `@gorhom/bottom-sheet` (её пропы —
 * надмножество `FlatListProps`). Снаружи решают, какой список подставить:
 * внутри шита выбора медиа скролл грида должен быть частью самого жеста
 * шита, а не отдельным `FlatList`.
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
    | 'ListEmptyComponent'
    | 'ListFooterComponent'
  >
>;

export type MediaGridProps = {
  /** Порядок = порядок выбора, а не порядок в галерее — так строится нумерация кружков. */
  selected: LibraryAsset[];
  onToggle: (asset: LibraryAsset) => void;
  ListComponent?: MediaListComponent;
};

/**
 * Грид последних фото и видео устройства. Максимально простой по задаче:
 * без альбомов, без предпросмотра — только выбор через кружок в углу
 * клетки.
 */
export function MediaGrid({ selected, onToggle, ListComponent = FlatList }: MediaGridProps) {
  const { width } = useWindowDimensions();
  const { status, items, isLoadingMore, hasMore, loadMore, requestAccess } = useRecentMedia();

  const cellSize = (width - GAP * (COLUMNS + 1)) / COLUMNS;
  const selectedIds = useMemo(
    () => new Map(selected.map((asset, index) => [asset.id, index + 1])),
    [selected],
  );
  const isFull = selected.length >= MediaLimits.gallery.maxSelection;

  const renderItem = useCallback<ListRenderItem<MediaLibraryItem>>(
    ({ item }) => {
      const selectionOrder = selectedIds.get(item.id) ?? null;

      return (
        <MediaGridItem
          asset={item}
          size={cellSize}
          selectionOrder={selectionOrder}
          disabled={isFull && selectionOrder === null}
          onToggle={(uri) =>
            onToggle({
              id: item.id,
              kind: item.kind,
              uri,
              width: item.width,
              height: item.height,
              durationMs: item.durationMs,
            })
          }
        />
      );
    },
    [cellSize, isFull, onToggle, selectedIds],
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
      onEndReachedThreshold={0.6}
      renderItem={renderItem}
      ListEmptyComponent={
        status === 'checking' ? null : (
          <View style={styles.notice}>
            <Text color="textSecondary">На устройстве нет фото и видео.</Text>
          </View>
        )
      }
      ListFooterComponent={isLoadingMore ? <View style={styles.footerSpace} /> : null}
    />
  );
}
