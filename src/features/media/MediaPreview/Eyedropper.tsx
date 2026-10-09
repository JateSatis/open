// Жест на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться.
 
import {
  Canvas,
  Circle,
  FilterMode,
  Group,
  ImageShader,
  MipmapMode,
  Rect,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, runOnUI, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { drawGeometry } from './drawGeometry';
import { loupeCenter, loupeMatrix, samplePixel, screenToPixel } from './eyedropperPixels';
import type { Rect as Box } from './previewStore';
import type { DrawZoom } from './useDrawTool';

import type { PhotoCrop } from '@/features/media/photoEdits/crop';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type EyedropperProps = {
  /** Видимое фото в пикселях рабочей копии (`visibleImageOf`). */
  sample: SkImage;
  crop: PhotoCrop;
  screen: SharedValue<Box>;
  area: SharedValue<Box>;
  zoom: DrawZoom;
  progress: SharedValue<number>;
  /** Палец отпущен — цвет под центром лупы, `#rrggbb`. */
  onPick: (rgb: string) => void;
};

const RADIUS = Sizes.drawLoupe / 2;
const CELL = Sizes.drawLoupe / Sizes.drawLoupePixels;
const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };

/**
 * Пипетка: лупа с фото, увеличенным до отдельных пикселей, белой окантовкой
 * и кольцом цвета под центром. Появляется в центре фото, палец ведёт её за
 * собой, отпущенный палец применяет цвет. Всё на UI-потоке: точка под
 * пальцем переводится в пиксель рабочей копии той же геометрией, что у
 * штриха (ужатие, увеличение, обрезка), цвет — чтение одного пикселя.
 */
export function Eyedropper({
  sample,
  crop,
  screen,
  area,
  zoom,
  progress,
  onPick,
}: EyedropperProps) {
  const theme = useTheme();
  const { scale, x, y } = zoom;
  const center = useSharedValue({ x: 0, y: 0 });

  const geometry = () => {
    'worklet';
    return drawGeometry(
      crop,
      screen.value,
      area.value,
      { scale: scale.value, x: x.value, y: y.value },
      progress.value,
    );
  };

  const moveTo = (px: number, py: number) => {
    'worklet';
    center.value = loupeCenter(geometry().frame, RADIUS, px, py);
  };

  // Лупа появляется в центре фото.
  useEffect(() => {
    runOnUI(() => {
      'worklet';
      const frame = geometry().frame;

      center.value = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    })();
    // Только когда пипетку взяли заново.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample]);

  const pixel = useDerivedValue(() =>
    screenToPixel(geometry(), sample.width(), center.value.x, center.value.y),
  );
  const color = useDerivedValue(
    () => samplePixel(sample, pixel.value.x, pixel.value.y) ?? theme.textOnMedia,
  );
  const matrix = useDerivedValue(() => loupeMatrix(crop, center.value, pixel.value, CELL));
  const clip = useDerivedValue(() => {
    const path = Skia.Path.Make();

    path.addCircle(center.value.x, center.value.y, RADIUS);

    return path;
  });
  const cx = useDerivedValue(() => center.value.x);
  const cy = useDerivedValue(() => center.value.y);
  const cellX = useDerivedValue(() => center.value.x - CELL / 2);
  const cellY = useDerivedValue(() => center.value.y - CELL / 2);
  const box = useDerivedValue(() => ({
    x: center.value.x - RADIUS,
    y: center.value.y - RADIUS,
    width: RADIUS * 2,
    height: RADIUS * 2,
  }));

  const gesture = useMemo(
    () =>
      Gesture.Manual()
        .shouldCancelWhenOutside(false)
        .onTouchesDown((event, manager) => {
          manager.activate();
          moveTo(event.allTouches[0].x, event.allTouches[0].y);
        })
        .onTouchesMove((event) => {
          moveTo(event.allTouches[0].x, event.allTouches[0].y);
        })
        .onTouchesUp((event, manager) => {
          if (event.allTouches.length > event.changedTouches.length) return;

          const rgb = samplePixel(sample, pixel.value.x, pixel.value.y);

          manager.end();
          if (rgb) runOnJS(onPick)(rgb);
        })
        .onTouchesCancelled((_event, manager) => {
          manager.end();
        }),
    // Ворклеты `geometry` и `moveTo` собираются из тех же значений.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [area, crop, onPick, pixel, progress, sample, scale, screen, x, y],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={gesture}>
        <View testID="draw-eyedropper-canvas" style={StyleSheet.absoluteFill} />
      </GestureDetector>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Circle
          cx={cx}
          cy={cy}
          r={RADIUS + Sizes.drawLoupeBorder + Sizes.drawLoupeRing / 2}
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
          r={RADIUS + Sizes.drawLoupeBorder / 2}
          style="stroke"
          strokeWidth={Sizes.drawLoupeBorder}
          color={theme.textOnMedia}
        />
      </Canvas>
    </View>
  );
}
