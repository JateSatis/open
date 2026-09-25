import { useWindowDimensions, View } from 'react-native';

import { SHEET_TOP_HEIGHT, styles } from './styles';

import { GridSkeleton, gridGeometry } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';

type SheetShellProps = {
  /** Верх свёрнутого шита в окне списка. */
  top: number;
  /** Высота свёрнутого шита — дальше рисовать незачем. */
  height: number;
};

/**
 * Первый кадр шита — подложка, ручка и сетка скелета, ровно там, где их
 * нарисует список. Стоит несколько вью, поэтому окно появляется сразу, а
 * список со всеми его клетками монтируется поверх, пока шит уже едет.
 *
 * Остаётся под списком и дальше: в свёрнутом положении список закрывает её
 * пиксель в пиксель, а в развёрнутом его непрозрачная подложка выше неё.
 */
export function SheetShell({ top, height }: SheetShellProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { rowHeight } = gridGeometry(width);

  return (
    <View
      testID="media-picker-shell"
      style={[styles.shell, { top, height, backgroundColor: theme.background }]}
      pointerEvents="none"
    >
      <View style={styles.sheetTop}>
        <View style={[styles.handleBar, { backgroundColor: theme.border }]} />
      </View>
      <GridSkeleton
        top={SHEET_TOP_HEIGHT}
        square={theme.backgroundElement}
        gap={theme.background}
        maxRows={Math.ceil(height / rowHeight)}
      />
    </View>
  );
}
