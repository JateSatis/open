import {
  Canvas,
  Circle,
  FilterMode,
  Group,
  ImageShader,
  MipmapMode,
  Rect,
  type SkImage,
} from '@shopify/react-native-skia';
import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { loupeMatrix } from './eyedropperPixels';

import type { PhotoCrop } from '@/features/media/photoEdits/crop';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type EyedropperLoupeProps = {
  sample: SkImage;
  crop: PhotoCrop;
  /** Центр лупы на экране. */
  center: SharedValue<{ x: number; y: number }>;
  /** Пиксель рабочей копии под центром. */
  pixel: SharedValue<{ x: number; y: number }>;
  /** Цвет под центром — кольцо снаружи. */
  color: SharedValue<string>;
  /** 0 — лупа ещё не встала на место и не видна. */
  shown: SharedValue<number>;
};

export const LOUPE_RADIUS = Sizes.drawLoupe / 2;
const CELL = Sizes.drawLoupe / Sizes.drawLoupePixels;
const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };

/**
 * Лупа пипетки: круг с фото, увеличенным до отдельных пикселей
 * (`drawLoupePixels` в поперечнике), рамка вокруг пикселя под центром,
 * белая окантовка и снаружи кольцо его цвета. Рисуется на UI-потоке из
 * shared values — палец двигает лупу без React на кадр.
 */
export function EyedropperLoupe({ sample, crop, center, pixel, color, shown }: EyedropperLoupeProps) {
  const theme = useTheme();
  const matrix = useDerivedValue(() => loupeMatrix(crop, center.value, pixel.value, CELL));
  const clip = useDerivedValue(() => ({
    rect: {
      x: center.value.x - LOUPE_RADIUS,
      y: center.value.y - LOUPE_RADIUS,
      width: LOUPE_RADIUS * 2,
      height: LOUPE_RADIUS * 2,
    },
    rx: LOUPE_RADIUS,
    ry: LOUPE_RADIUS,
  }));
  const box = useDerivedValue(() => clip.value.rect);
  const cx = useDerivedValue(() => center.value.x);
  const cy = useDerivedValue(() => center.value.y);
  const cellX = useDerivedValue(() => center.value.x - CELL / 2);
  const cellY = useDerivedValue(() => center.value.y - CELL / 2);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Group opacity={shown}>
        <Circle
          cx={cx}
          cy={cy}
          r={LOUPE_RADIUS + Sizes.drawLoupeBorder + Sizes.drawLoupeRing / 2}
          style="stroke"
          strokeWidth={Sizes.drawLoupeRing}
          color={color}
        />
        <Group clip={clip}>
          <Rect rect={box}>
            <ImageShader image={sample} fit="none" matrix={matrix} sampling={NEAREST} />
          </Rect>
          <Rect
            x={cellX}
            y={cellY}
            width={CELL}
            height={CELL}
            style="stroke"
            strokeWidth={Sizes.drawLoupeBorder / 2}
            color={theme.textOnMedia}
          />
        </Group>
        <Circle
          cx={cx}
          cy={cy}
          r={LOUPE_RADIUS + Sizes.drawLoupeBorder / 2}
          style="stroke"
          strokeWidth={Sizes.drawLoupeBorder}
          color={theme.textOnMedia}
        />
      </Group>
    </Canvas>
  );
}
