import { FlatList, View, useWindowDimensions } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { MediaGridItem } from '@/features/media/MediaGridItem';
import { MediaLimits } from '@/features/media/constants';
import type { LibraryAsset } from '@/features/media/mediaLibrary';
import { useRecentMedia } from '@/features/media/useRecentMedia';
import { Spacing } from '@/theme';

const COLUMNS = 3;
const GAP = Spacing.half;

export type MediaGridProps = {
  /** Порядок = порядок выбора, а не порядок в галерее — так строится нумерация кружков. */
  selected: LibraryAsset[];
  onToggle: (asset: LibraryAsset) => void;
};

/**
 * Грид последних фото и видео устройства. Максимально простой по задаче:
 * без альбомов, без предпросмотра — только выбор через кружок в углу
 * клетки.
 */
export function MediaGrid({ selected, onToggle }: MediaGridProps) {
  const { width } = useWindowDimensions();
  const { status, items, isLoadingMore, hasMore, loadMore, requestAccess } = useRecentMedia();

  const cellSize = (width - GAP * (COLUMNS + 1)) / COLUMNS;
  const selectedIds = new Map(selected.map((asset, index) => [asset.id, index + 1]));
  const isFull = selected.length >= MediaLimits.gallery.maxSelection;

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

  return (
    <FlatList
      testID="media-grid"
      data={items}
      numColumns={COLUMNS}
      keyExtractor={(asset) => asset.id}
      contentContainerStyle={styles.content}
      columnWrapperStyle={styles.row}
      onEndReached={hasMore ? loadMore : undefined}
      onEndReachedThreshold={0.6}
      renderItem={({ item }) => {
        const selectionOrder = selectedIds.get(item.id) ?? null;

        return (
          <MediaGridItem
            asset={item}
            size={cellSize}
            selectionOrder={selectionOrder}
            disabled={isFull && selectionOrder === null}
            onToggle={() => onToggle(item)}
          />
        );
      }}
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
