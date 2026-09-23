import { FlashList, type FlashListProps, type ListRenderItem } from '@shopify/flash-list';
import { useCallback, useMemo, type ComponentType, type ReactElement } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { GRID_COLUMNS, cellsToFill, gridGeometry } from './gridLayout';
import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { MediaGridItem } from '@/features/media/MediaGridItem';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { countRender, perfLog } from '@/features/media/perf';
import { useMediaSelection } from '@/features/media/selectionStore';
import { useGalleryAssets } from '@/features/media/useGalleryAssets';
import { useTheme } from '@/hooks/use-theme';

/**
 * Клетка грида: либо файл, либо место под файл, которого ещё нет.
 *
 * `null` — это не «пустая клетка» в смысле дырки, а скелет: серый квадрат
 * ровно того же размера и в той же сетке. Он существует только пока галерея
 * читается; как только файлы приехали, `null` в данных не остаётся.
 */
export type GridCell = MediaLibraryItem | null;

/**
 * Минимальный набор пропов, которым пользуется грид. Снаружи решают, какой
 * список подставить: шит подставляет свой, чтобы добавить к нему подложку и
 * слежение за позицией скролла.
 */
export type MediaListComponent = ComponentType<
  Pick<
    FlashListProps<GridCell>,
    | 'testID'
    | 'data'
    | 'numColumns'
    | 'keyExtractor'
    | 'contentContainerStyle'
    | 'renderItem'
    | 'drawDistance'
    | 'getItemType'
    | 'ListEmptyComponent'
    | 'ListHeaderComponent'
    | 'ListFooterComponent'
  >
>;

export type MediaGridProps = {
  ListComponent?: MediaListComponent;
  /** Шапка списка: внутри шита ею становится пустое место над шитом. */
  header?: ReactElement | null;
  /** Хвост списка: место под тем, что перекрывает грид снизу (строка ввода). */
  footer?: ReactElement | null;
  /**
   * Нижняя граница высоты содержимого. Подложка шита живёт в координатах
   * содержимого и тянется до его конца — значит содержимое обязано быть не
   * короче окна, иначе под ним осталась бы непокрытая полоса.
   */
  minContentHeight?: number;
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
 *
 * Список — `FlashList`, а не `FlatList`, ради переиспользования вью. У
 * `FlatList` каждая появившаяся клетка монтируется заново (замер: 150–228
 * монтирований за две секунды быстрого скролла, ровно столько же, сколько
 * рендеров), и на скорости он не успевает — на месте клеток оставались
 * дырки. `FlashList` v2 держит пул вью и переиспользует их; заодно это
 * лекарство от роста памяти на длинной галерее.
 */
export function MediaGrid({
  ListComponent = FlashList,
  header = null,
  footer = null,
  minContentHeight = 0,
  enabled = true,
}: MediaGridProps) {
  countRender('MediaGrid');

  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const { status, items, total, requestAccess } = useGalleryAssets(enabled);
  const toggle = useMediaSelection((state) => state.toggle);

  const { cellSize, rowHeight } = gridGeometry(width);

  /**
   * Данные списка: сначала настоящие файлы, за ними — скелет до известной
   * длины галереи. Пока длина неизвестна, скелета ровно на экран с запасом.
   *
   * Скелет живёт в данных, а не отдельным слоем поверх, ровно потому, что
   * сетка у него обязана совпасть с настоящей: это те же клетки того же
   * списка, разойтись им негде.
   */
  const data = useMemo<GridCell[]>(() => {
    if (status === 'denied' || status === 'empty') return [];

    const known = total ?? cellsToFill(height, rowHeight);
    const missing = Math.max(0, known - items.length);

    if (missing === 0) return items;

    return [...items, ...(new Array(missing).fill(null) as null[])];
  }, [height, items, rowHeight, status, total]);

  const renderItem = useCallback<ListRenderItem<GridCell>>(
    ({ item }) => (
      <View style={[styles.cell, { height: rowHeight }]}>
        {item === null ? (
          <View
            testID="media-grid-skeleton"
            style={[
              styles.skeleton,
              { width: cellSize, height: cellSize, backgroundColor: theme.backgroundElement },
            ]}
          />
        ) : (
          <MediaGridItem asset={item} size={cellSize} onToggle={toggle} />
        )}
      </View>
    ),
    [cellSize, rowHeight, theme.backgroundElement, toggle],
  );

  /**
   * Файл и скелет — один тип для пула вью: клетка у них устроена одинаково,
   * и разделять пул значило бы монтировать новую вью там, где хватило бы
   * переиспользования.
   */
  const getItemType = useCallback(() => 'cell', []);

  const keyExtractor = useCallback(
    (item: GridCell, index: number) => item?.id ?? `skeleton-${index}`,
    [],
  );

  const contentContainerStyle = useMemo(
    () => ({ ...styles.content, minHeight: minContentHeight }),
    [minContentHeight],
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

  perfLog('грид: данные', { status, файлов: items.length, всего: total, клеток: data.length });

  return (
    <List
      testID="media-grid"
      data={data}
      numColumns={GRID_COLUMNS}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      contentContainerStyle={contentContainerStyle}
      renderItem={renderItem}
      // Запас отрисовки за краем экрана: по умолчанию его четверть экрана, и
      // клетка появляется ровно тогда, когда её уже видно. Экран в каждую
      // сторону стоит дёшево — клетки переиспользуются, а не монтируются.
      //
      // На резком броске не спасает никакой запас (замер: пусто до 2.5 с и при
      // четверти экрана, и при целом) — там место под клетку держит `GridSkeleton`,
      // который вообще не зависит от виртуализации.
      drawDistance={height}
      ListHeaderComponent={header}
      ListEmptyComponent={
        status === 'empty' ? (
          <View style={styles.empty}>
            <Text color="textSecondary">На устройстве нет фото и видео.</Text>
          </View>
        ) : null
      }
      ListFooterComponent={footer}
    />
  );
}
