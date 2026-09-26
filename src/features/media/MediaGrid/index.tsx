import { FlashList, type FlashListProps, type ListRenderItem } from '@shopify/flash-list';
import { useCallback, useMemo, type ComponentType, type ReactElement } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { GRID_COLUMNS, rowsToFill } from './gridLayout';
import { styles } from './styles';
import { useGridGeometry } from './useGridGeometry';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { MediaGridRow, type GridCell } from '@/features/media/MediaGridRow';
import { countRender, perfLog } from '@/features/media/perf';
import { useMediaSelection } from '@/features/media/selectionStore';
import { useGalleryAssets } from '@/features/media/useGalleryAssets';

export type { GridCell } from '@/features/media/MediaGridRow';

/** Строка списка — три клетки сетки. */
export type GridRow = {
  index: number;
  cells: GridCell[];
};

/**
 * Минимальный набор пропов, которым пользуется грид. Снаружи решают, какой
 * список подставить: шит подставляет свой, чтобы добавить к нему подложку и
 * слежение за позицией скролла.
 */
export type MediaListComponent = ComponentType<
  Pick<
    FlashListProps<GridRow>,
    | 'testID'
    | 'data'
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

  const { height } = useWindowDimensions();
  const geometry = useGridGeometry();
  const { status, items, total, requestAccess } = useGalleryAssets(enabled);
  const toggle = useMediaSelection((state) => state.toggle);

  /**
   * Строки списка: сначала настоящие файлы, за ними — скелет до известной
   * длины галереи. Пока длина неизвестна, скелета ровно на экран с запасом.
   *
   * Список идёт строками, а не клетками с `numColumns`: `FlashList` делит
   * ширину на колонки сам, и края клеток попадали бы на дробные пиксели.
   */
  const rows = useMemo<GridRow[]>(() => {
    if (status === 'denied' || status === 'empty') return [];

    const known = total ?? rowsToFill(height, geometry.pitch) * GRID_COLUMNS;
    const count = Math.max(known, items.length);

    return Array.from({ length: Math.ceil(count / GRID_COLUMNS) }, (_, index) => {
      const cells: GridCell[] = [];

      for (let column = 0; column < GRID_COLUMNS; column += 1) {
        const at = index * GRID_COLUMNS + column;

        if (at < count) cells.push(items[at] ?? null);
      }

      return { index, cells };
    });
  }, [geometry.pitch, height, items, status, total]);

  const renderItem = useCallback<ListRenderItem<GridRow>>(
    ({ item }) => <MediaGridRow cells={item.cells} geometry={geometry} onToggle={toggle} />,
    [geometry, toggle],
  );

  /** Все строки одинаковы по устройству — один пул вью на всех. */
  const getItemType = useCallback(() => 'row', []);

  const keyExtractor = useCallback((row: GridRow) => String(row.index), []);

  const contentContainerStyle = useMemo(
    () => ({ minHeight: minContentHeight }),
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

  perfLog('грид: данные', { status, файлов: items.length, всего: total, строк: rows.length });

  return (
    <List
      testID="media-grid"
      data={rows}
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
