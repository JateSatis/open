import { BlurMask, Group, ImageShader, Path, Skia } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

import { strokePath } from './paintDrawing';
import type { LiveDraw } from './useDrawTool';

import {
  BLUR_EDGE,
  isColorBrush,
  MARKER_OPACITY,
  type DrawBrush,
} from '@/features/media/photoEdits/drawing';

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
 * размытие — размытым фото сквозь мягкую маску, ластик вычищает слой. Стрелка
 * без наконечника: он появляется, когда палец отпущен.
 */
export function LiveStroke({ draw, imageWidth, layer }: LiveStrokeProps) {
  // Ворклеты берут shared values по одному, а не весь объект с картинкой.
  const { brush: brushValue, points, width: strokeWidth } = draw;
  const units = [imageWidth, 0, 0, 0, imageWidth, 0, 0, 0, 1];
  const inUnits = [1 / imageWidth, 0, 0, 0, 1 / imageWidth, 0, 0, 0, 1];

  const pathFor = (wanted: (brush: DrawBrush) => boolean) => {
    'worklet';
    const brush = brushValue.value;

    return wanted(brush)
      ? strokePath(points.value, brush, strokeWidth.value, false)
      : Skia.Path.Make();
  };

  const paint = useDerivedValue(() =>
    pathFor((brush) => {
      'worklet';
      return layer === 'blur' ? brush === 'blur' : isColorBrush(brush);
    }),
  );
  const erase = useDerivedValue(() =>
    pathFor((brush) => {
      'worklet';
      return brush === 'eraser';
    }),
  );
  const edge = useDerivedValue(() => strokeWidth.value * BLUR_EDGE);
  const cap = useDerivedValue(() => (brushValue.value === 'marker' ? 'square' : 'round'));
  const opacity = useDerivedValue(() => (brushValue.value === 'marker' ? MARKER_OPACITY : 1));

  return (
    <Group matrix={units}>
      {layer === 'blur' ? (
        draw.blurred ? (
          <Path
            path={paint}
            style="stroke"
            strokeWidth={strokeWidth}
            strokeCap="round"
            strokeJoin="round"
          >
            <ImageShader image={draw.blurred} fit="none" matrix={inUnits} />
            <BlurMask blur={edge} style="normal" respectCTM />
          </Path>
        ) : null
      ) : (
        <Path
          path={paint}
          style="stroke"
          strokeWidth={strokeWidth}
          strokeCap={cap}
          strokeJoin="round"
          color={draw.color}
          opacity={opacity}
        />
      )}
      <Path
        path={erase}
        style="stroke"
        strokeWidth={strokeWidth}
        strokeCap="round"
        strokeJoin="round"
        blendMode="clear"
      />
    </Group>
  );
}
