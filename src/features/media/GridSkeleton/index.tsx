import { useMemo } from 'react';
import { View, type ViewStyle } from 'react-native';

import { styles } from './styles';

import { MediaLimits } from '@/features/media/constants';
import { GRID_COLUMNS, type GridGeometry } from '@/features/media/MediaGrid/gridLayout';
import { useGridGeometry } from '@/features/media/MediaGrid/useGridGeometry';

/**
 * Сколько строк сетки рисует один кусок слоя.
 *
 * Слой нарезан на куски: сплошная вью во всю высоту содержимого (у галереи в
 * три тысячи файлов это больше трёхсот тысяч пикселей) на Android перестаёт
 * рисоваться, стоит отскроллить вглубь. Кусок в двадцать строк — около семи
 * тысяч пикселей, такую вью система рисует везде.
 */
export const SEGMENT_ROWS = 20;

export type GridSkeletonProps = {
  /** Где начинается первая строка сетки, считая от верха этого слоя. */
  top: number;
  /** Цвет квадратов. */
  square: string;
  /** Цвет зазоров — он же фон шита. */
  gap: string;
  /** Сколько строк нарисовать; по умолчанию — на самую длинную галерею. */
  maxRows?: number;
};

/**
 * Зазоры сетки — фоном самой вью: две повторяющиеся полосы-градиента, одна
 * даёт вертикальные зазоры, другая горизонтальные. Их рисует шейдер плиткой
 * прямо на холсте, без промежуточной картинки: `Image` с `resizeMode="repeat"`
 * на Android собирал битмап размером со всю вью, по 30 МБ на кусок.
 *
 * Размеры — из `gridGeometry`, то есть в целых физических пикселях, и
 * совпадают с клетками грида до пикселя на любой глубине.
 */
function segmentStyle(geometry: GridGeometry, square: string, gap: string): ViewStyle {
  const { cellSize, gap: gapSize, pitch, width } = geometry;

  return {
    width,
    height: pitch * SEGMENT_ROWS,
    backgroundColor: square,
    experimental_backgroundImage: [
      `linear-gradient(to right, ${gap} 0px, ${gap} ${gapSize}px, transparent ${gapSize}px)`,
      `linear-gradient(to bottom, transparent ${cellSize}px, ${gap} ${cellSize}px)`,
    ].join(', '),
    experimental_backgroundSize: `${pitch}px 100%, 100% ${pitch}px`,
    experimental_backgroundRepeat: 'repeat',
  };
}

/**
 * Сетка серых квадратов на всю высоту содержимого — слоем, а не клетками
 * списка.
 *
 * Место под клетку должно быть занято мгновенно, на любой скорости скролла.
 * Пока скелет рисуют сами клетки, «успевать» приходится виртуализации, а на
 * резком броске она не успевает. Этот слой не монтируется по ходу скролла и
 * не пересчитывается — он просто нарисован.
 */
export function GridSkeleton({
  top,
  square,
  gap,
  maxRows = Math.ceil(MediaLimits.gallery.maxAssets / GRID_COLUMNS),
}: GridSkeletonProps) {
  const geometry = useGridGeometry();
  const style = useMemo(() => segmentStyle(geometry, square, gap), [gap, geometry, square]);
  const segments = Math.ceil(maxRows / SEGMENT_ROWS);

  return (
    <View testID="grid-skeleton" style={[styles.layer, { top }]} pointerEvents="none">
      {Array.from({ length: segments }, (_, index) => (
        <View key={index} testID="grid-skeleton-segment" style={style} />
      ))}
    </View>
  );
}
