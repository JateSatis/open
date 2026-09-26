import { memo } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

import type { GridGeometry } from '@/features/media/MediaGrid/gridLayout';
import { MediaGridItem } from '@/features/media/MediaGridItem';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { useTheme } from '@/hooks/use-theme';

/**
 * Клетка грида: либо файл, либо место под файл, которого ещё нет. `null` —
 * серый квадрат ровно того же размера: он существует, пока галерея читается.
 */
export type GridCell = MediaLibraryItem | null;

export type MediaGridRowProps = {
  cells: GridCell[];
  geometry: GridGeometry;
  onToggle: (asset: MediaLibraryItem) => void;
};

/**
 * Строка грида. Клетки стоят на позициях из `gridGeometry`, а не делят
 * ширину между собой: так их края попадают на целые пиксели — те же, на
 * которых нарисован скелет под ними.
 */
export const MediaGridRow = memo(function MediaGridRow({
  cells,
  geometry,
  onToggle,
}: MediaGridRowProps) {
  const theme = useTheme();
  const { cellSize, pitch, columnLeft } = geometry;

  return (
    <View style={{ height: pitch }}>
      {cells.map((cell, column) => (
        <View
          key={column}
          style={[styles.cell, { left: columnLeft[column], width: cellSize, height: cellSize }]}
        >
          {cell === null ? (
            <View
              testID="media-grid-skeleton"
              style={[styles.skeleton, { backgroundColor: theme.backgroundElement }]}
            />
          ) : (
            <MediaGridItem asset={cell} size={cellSize} onToggle={onToggle} />
          )}
        </View>
      ))}
    </View>
  );
});
