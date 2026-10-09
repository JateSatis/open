import { Group, ImageShader, Path, Skia, type SkImage } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

import { strokePath } from './paintDrawing';
import type { LiveDraw } from './useDrawTool';

import { isColorBrush, MARKER_OPACITY } from '@/features/media/photoEdits/drawing';

export type LiveStrokeProps = {
  draw: LiveDraw;
  /** Ширина рабочей копии: группа выше — в её пикселях, штрих — в единицах фото. */
  imageWidth: number;
  /** В какой слой рисунка ложится штрих. */
  layer: 'blur' | 'lines';
};

/**
 * Штрих под пальцем — путь из точек в shared value, на UI-потоке, без
 * React на кадр. Рисуется так же, как ляжет в слой: перо и маркер — линией,
 * размытие заменяет пиксели размытой копией (фото — в слое размытия,
 * нарисованного — в линиях), ластик вычищает слой. Стрелка без наконечника:
 * он появляется, когда палец отпущен.
 *
 * Shared values читаются прямо в каждом вычислении, а не во вложенной
 * функции: зависимости Reanimated собирает только из замыкания самого
 * вычисления, и путь из вложенной функции не пересчитывался бы по ходу штриха.
 */
export function LiveStroke({ draw, imageWidth, layer }: LiveStrokeProps) {
  const { brush, points, width } = draw;
  const units = [imageWidth, 0, 0, 0, imageWidth, 0, 0, 0, 1];
  const inUnits = [1 / imageWidth, 0, 0, 0, 1 / imageWidth, 0, 0, 0, 1];
  const blurSource: SkImage | null = layer === 'blur' ? draw.blurred : draw.blurredLines;

  const line = useDerivedValue(() =>
    layer === 'lines' && isColorBrush(brush.value)
      ? strokePath(points.value, brush.value, width.value, false)
      : Skia.Path.Make(),
  );
  const blur = useDerivedValue(() =>
    brush.value === 'blur'
      ? strokePath(points.value, brush.value, width.value, false)
      : Skia.Path.Make(),
  );
  const erase = useDerivedValue(() =>
    brush.value === 'eraser'
      ? strokePath(points.value, brush.value, width.value, false)
      : Skia.Path.Make(),
  );
  const cap = useDerivedValue(() => (brush.value === 'marker' ? 'square' : 'round'));
  const opacity = useDerivedValue(() => (brush.value === 'marker' ? MARKER_OPACITY : 1));

  return (
    <Group matrix={units}>
      {layer === 'lines' ? (
        <Path
          path={line}
          style="stroke"
          strokeWidth={width}
          strokeCap={cap}
          strokeJoin="round"
          color={draw.color}
          opacity={opacity}
        />
      ) : null}
      {blurSource ? (
        <Path
          path={blur}
          style="stroke"
          strokeWidth={width}
          strokeCap="round"
          strokeJoin="round"
          blendMode="src"
        >
          <ImageShader image={blurSource} fit="none" matrix={inUnits} />
        </Path>
      ) : null}
      <Path
        path={erase}
        style="stroke"
        strokeWidth={width}
        strokeCap="round"
        strokeJoin="round"
        blendMode="clear"
      />
    </Group>
  );
}
