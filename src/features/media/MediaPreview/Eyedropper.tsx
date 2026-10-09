// Жест на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться.
/* eslint-disable react-hooks/immutability */
import type { SkImage } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  runOnJS,
  runOnUI,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { drawGeometry } from './drawGeometry';
import { loupeCenter, samplePixel, screenToPixel } from './eyedropperPixels';
import { EyedropperLoupe, LOUPE_RADIUS } from './EyedropperLoupe';
import type { Rect as Box } from './previewStore';
import type { DrawZoom } from './useDrawTool';

import type { PhotoCrop } from '@/features/media/photoEdits/crop';
import { useTheme } from '@/hooks/use-theme';

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
  /** Цвет не прочитался — пипетка закрывается, цвет прежний. */
  onCancel: () => void;
};

/**
 * Пипетка: лупа появляется в центре фото, палец ведёт её за собой,
 * отпущенный палец применяет цвет под её центром. Всё на UI-потоке: точка
 * лупы переводится в пиксель рабочей копии той же геометрией, что у штриха
 * (ужатие, увеличение, обрезка), цвет — чтение одного пикселя.
 */
export function Eyedropper({
  sample,
  crop,
  screen,
  area,
  zoom,
  progress,
  onPick,
  onCancel,
}: EyedropperProps) {
  const theme = useTheme();
  const { scale, x, y } = zoom;
  const center = useSharedValue({ x: 0, y: 0 });
  const shown = useSharedValue(0);
  const fallback = theme.textOnMedia;

  const gesture = useMemo(() => {
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
      center.value = loupeCenter(geometry().frame, LOUPE_RADIUS, px, py);
    };

    return Gesture.Manual()
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

        // Пиксель — от центра прямо сейчас: производное значение обновится
        // только к следующему кадру и может отстать от последнего сдвига.
        const g = geometry();
        const pixel = screenToPixel(g, sample.width(), center.value.x, center.value.y);
        const rgb = samplePixel(sample, pixel.x, pixel.y);

        manager.end();
        if (rgb) runOnJS(onPick)(rgb);
        else runOnJS(onCancel)();
      })
      .onTouchesCancelled((_event, manager) => {
        manager.end();
      });
  }, [area, center, crop, onCancel, onPick, progress, sample, scale, screen, x, y]);

  // Лупа встаёт в центр фото и только тогда проявляется: до этого центр — угол экрана.
  useEffect(() => {
    runOnUI(() => {
      'worklet';
      const frame = drawGeometry(
        crop,
        screen.value,
        area.value,
        { scale: scale.value, x: x.value, y: y.value },
        progress.value,
      ).frame;

      center.value = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
      shown.value = 1;
    })();
  }, [area, center, crop, progress, sample, scale, screen, shown, x, y]);

  const pixel = useDerivedValue(() =>
    screenToPixel(
      drawGeometry(
        crop,
        screen.value,
        area.value,
        { scale: scale.value, x: x.value, y: y.value },
        progress.value,
      ),
      sample.width(),
      center.value.x,
      center.value.y,
    ),
  );
  const color = useDerivedValue(
    () => samplePixel(sample, pixel.value.x, pixel.value.y) ?? fallback,
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={gesture}>
        <View testID="draw-eyedropper-canvas" style={StyleSheet.absoluteFill} />
      </GestureDetector>
      <EyedropperLoupe
        sample={sample}
        crop={crop}
        center={center}
        pixel={pixel}
        color={color}
        shown={shown}
      />
    </View>
  );
}
