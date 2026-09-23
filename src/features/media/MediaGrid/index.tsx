import { useCallback, type ComponentType, type ReactElement } from 'react';
import { FlatList, View, useWindowDimensions, type FlatListProps, type ListRenderItem } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { MediaGridItem } from '@/features/media/MediaGridItem';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { countRender } from '@/features/media/perf';
import { useMediaSelection } from '@/features/media/selectionStore';
import { useGalleryAssets } from '@/features/media/useGalleryAssets';
import { Spacing } from '@/theme';

const COLUMNS = 3;
const GAP = Spacing.half;

/** Клеток в первом кадре — с запасом на высокий экран, чтобы грид открылся заполненным. */
const INITIAL_ROWS = 8;
/** Сколько строк грид дорисовывает за один проход — иначе скролл опережает отрисовку. */
const ROWS_PER_BATCH = 6;
/**
 * Экранов содержимого вокруг видимой зоны. По умолчанию их 21, то есть при
 * галерее в три тысячи файлов список держит смонтированными около трёхсот
 * клеток — их приходится и рисовать, и разбирать при закрытии шита. Запас в
 * два экрана в каждую сторону тут ничего не стоит: строки фиксированной
 * высоты, а превью грузит сам expo-image.
 */
const WINDOW_SIZE = 5;

/**
 * Минимальный набор пропов, которым пользуется грид — им отвечает и обычный
 * `FlatList`, и `Animated.FlatList`. Снаружи решают, какой список
 * подставить: внутри шита положение самого шита считается из скролла этого
 * списка, поэтому шит подставляет свой.
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
    | 'renderItem'
    | 'getItemLayout'
    | 'initialNumToRender'
    | 'maxToRenderPerBatch'
    | 'windowSize'
    | 'ListEmptyComponent'
    | 'ListHeaderComponent'
    | 'ListFooterComponent'
  >
>;

export type MediaGridProps = {
  ListComponent?: MediaListComponent;
  /** Шапка списка: внутри шита ею становится пустое место над шитом. */
  header?: ReactElement | null;
  /**
   * Высота шапки. Списку её нужно знать числом: `getItemLayout` считает
   * положение строки от начала содержимого, а шапка это начало сдвигает.
   */
  headerHeight?: number;
  /** Хвост списка: место под тем, что перекрывает грид снизу (строка ввода). */
  footer?: ReactElement | null;
  /**
   * Пока `false`, грид не трогает медиатеку вовсе. Нужно, чтобы запрос
   * разрешения и чтение галереи не отнимали кадры у анимации открытия шита.
   */
  enabled?: boolean;
};

/**
 * Грид последних фото и видео устройства. Максимально простой по задаче:
 * без альбомов, без предпросмотра — только выбор через кружок в углу
 * клетки.
 *
 * Выбранное живёт в `selectionStore`, а не приходит пропом: грид не
 * перерисовывается от того, что человек тронул кружок.
 */
export function MediaGrid({
  ListComponent = FlatList,
  header = null,
  headerHeight = 0,
  footer = null,
  enabled = true,
}: MediaGridProps) {
  countRender('MediaGrid');

  const { width } = useWindowDimensions();
  const { status, items, requestAccess } = useGalleryAssets(enabled);
  const toggle = useMediaSelection((state) => state.toggle);

  const cellSize = (width - GAP * (COLUMNS + 1)) / COLUMNS;
  const rowHeight = cellSize + GAP;

  const renderItem = useCallback<ListRenderItem<MediaLibraryItem>>(
    ({ item }) => <MediaGridItem asset={item} size={cellSize} onToggle={toggle} />,
    [cellSize, toggle],
  );

  // Клетки квадратные и одного размера, значит положение любой строки
  // известно заранее — списку не нужно её измерять, чтобы отрисовать, и
  // прыжок в любую точку галереи ничего не считает.
  const getItemLayout = useCallback(
    (_: ArrayLike<MediaLibraryItem> | null | undefined, index: number) => ({
      length: rowHeight,
      offset: headerHeight + GAP + rowHeight * Math.floor(index / COLUMNS),
      index,
    }),
    [headerHeight, rowHeight],
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
      getItemLayout={getItemLayout}
      initialNumToRender={COLUMNS * INITIAL_ROWS}
      maxToRenderPerBatch={COLUMNS * ROWS_PER_BATCH}
      windowSize={WINDOW_SIZE}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListEmptyComponent={
        status === 'checking' || !enabled ? null : (
          <View style={styles.notice}>
            <Text color="textSecondary">На устройстве нет фото и видео.</Text>
          </View>
        )
      }
      ListFooterComponent={footer}
    />
  );
}
