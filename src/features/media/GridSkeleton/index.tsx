import { useMemo } from 'react';
import { Image, PixelRatio, StyleSheet, View, useWindowDimensions } from 'react-native';

import { styles } from './styles';

import { MediaLimits } from '@/features/media/constants';
import {
  GRID_CELL_PADDING,
  GRID_COLUMNS,
  GRID_GAP,
  gridGeometry,
} from '@/features/media/MediaGrid/gridLayout';
import { horizontalRuleTile, parseHexColor } from '@/features/media/MediaGrid/skeletonTile';

/**
 * Сколько строк сетки рисует один кусок слоя.
 *
 * Слой нарезан на куски не ради экономии: сплошная вью во всю высоту
 * содержимого (у галереи в три тысячи файлов это больше трёхсот тысяч
 * пикселей) на Android просто перестаёт рисоваться, стоит отскроллить вглубь —
 * проверено на записи экрана, причём и с картинкой, и с одним только фоном.
 * Кусок в двадцать строк — это семь тысяч пикселей, такую вью система рисует
 * везде.
 *
 * Высота куска обязана быть целым числом шагов сетки: иначе плитка зазоров в
 * следующем куске начнётся не с той фазы, и стык будет видно.
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

type SegmentProps = {
  height: number;
  square: string;
  gap: string;
  rule: string;
  columnRules: number[];
};

function GridSkeletonSegment({ height, square, gap, rule, columnRules }: SegmentProps) {
  return (
    <View testID="grid-skeleton-segment" style={{ height }}>
      {/* Холст квадратов. От краёв экрана отступает на зазор — там, где у
          настоящей сетки поля. */}
      <View style={[styles.canvas, { backgroundColor: square }]} />

      {columnRules.map((left) => (
        <View key={left} style={[styles.columnRule, { left, backgroundColor: gap }]} />
      ))}

      <Image
        testID="grid-skeleton-rule"
        source={{ uri: rule }}
        style={StyleSheet.absoluteFill}
        // Повтор, а не растяжение: одна плитка высотой в шаг сетки закрывает
        // весь кусок, и шаг при этом не накапливает ошибку.
        resizeMode="repeat"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

/**
 * Сетка серых квадратов на всю высоту содержимого — слоем, а не клетками
 * списка.
 *
 * Зачем: место под клетку должно быть занято мгновенно, на любой скорости
 * скролла. Пока скелет рисуют сами клетки, «успевать» приходится
 * виртуализации, а она не успевает: на резком броске список не показывает ни
 * одной клетки до 2.5 с (замер по записи экрана с `FlashList` v2; с
 * `FlatList` было не лучше). Этот слой не монтируется по ходу скролла и не
 * пересчитывается — он просто нарисован, и обгонять его нечему.
 *
 * Внутри куска всего четыре вью на двадцать строк: серый холст, два
 * вертикальных зазора и одна картинка шириной в пиксель, растиражированная по
 * вертикали с шагом сетки. Тиражирование идёт в физических пикселях, поэтому
 * зазоры скелета стоят там же, где у настоящих клеток, — иначе в момент
 * подмены скелета фотографиями сетка бы дёрнулась.
 */
export function GridSkeleton({
  top,
  square,
  gap,
  maxRows = Math.ceil(MediaLimits.gallery.maxAssets / GRID_COLUMNS),
}: GridSkeletonProps) {
  const { width } = useWindowDimensions();
  const { cellSize, rowHeight } = gridGeometry(width);
  const columnWidth = cellSize + GRID_CELL_PADDING * 2;

  const rule = useMemo(
    () =>
      horizontalRuleTile({
        pitchPx: PixelRatio.getPixelSizeForLayoutSize(rowHeight),
        rulePx: PixelRatio.getPixelSizeForLayoutSize(GRID_GAP),
        color: parseHexColor(gap),
      }),
    [gap, rowHeight],
  );

  // Границы между колонками: их всего две, тиражировать нечего.
  const columnRules = useMemo(
    () => Array.from({ length: GRID_COLUMNS - 1 }, (_, index) => (index + 1) * columnWidth),
    [columnWidth],
  );

  // Кусков ровно столько, сколько нужно на самую длинную галерею, которую
  // грид вообще показывает. Лишние обрежет сам слой.
  const segments = Math.ceil(maxRows / SEGMENT_ROWS);
  const segmentHeight = rowHeight * SEGMENT_ROWS;

  return (
    <View testID="grid-skeleton" style={[styles.layer, { top }]} pointerEvents="none">
      {Array.from({ length: segments }, (_, index) => (
        <GridSkeletonSegment
          key={index}
          height={segmentHeight}
          square={square}
          gap={gap}
          rule={rule}
          columnRules={columnRules}
        />
      ))}
    </View>
  );
}
