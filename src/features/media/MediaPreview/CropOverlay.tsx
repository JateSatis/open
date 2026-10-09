import { Canvas, ColorMatrix, Group, ImageShader, Path, Rect } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { cropVisual, imagePlacement, type CropMotion } from './cropMotion';
import { PHOTO_SAMPLING } from './EditedPhoto';
import { useCropPaths } from './useCropPaths';
import { useCropGestures } from './useCropGestures';
import type { CropSession } from './useCropTool';

import { adjustColorMatrix } from '@/features/media/photoEdits/colorMatrix';
import { affineToMatrix, type PhotoCrop } from '@/features/media/photoEdits/crop';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Sizes } from '@/theme';

export type CropOverlayProps = {
  session: CropSession;
  motion: CropMotion;
  rotationBase: SharedValue<PhotoCrop | null>;
  /** Касания принимаются, только пока инструмент открыт, — не на выходе. */
  active: boolean;
  /** Первый кадр нарисован: можно прятать страницу под слоем. */
  onReady: () => void;
};

/**
 * Фото в обрезке поверх страницы предпросмотра: внутри рамки — как будет,
 * снаружи — под затемнением; окантовка, уголки-ручки и сетка 3×3, пока
 * тянут или крутят. Всё считается на UI-потоке из `CropMotion`, React на
 * кадр не перерисовывается.
 *
 * Вход и выход — тот же слой: на нулевом кадре он совпадает со страницей
 * (рамка там, где фото на странице, за рамкой — ничего), и страница под ним
 * прячется незаметно.
 */
export function CropOverlay({ session, motion, rotationBase, active, onReady }: CropOverlayProps) {
  const theme = useTheme();
  const gesture = useCropGestures(motion, rotationBase);
  const { image } = session;
  const imageWidth = image.width();
  const imageHeight = image.height();
  const colors = useMemo(() => adjustColorMatrix(session.adjust), [session.adjust]);

  // Два кадра: Skia рисует слой на следующем кадре после монтирования.
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(onReady);
    });

    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [onReady]);

  const visual = useDerivedValue(() => cropVisual(motion));
  const group = useDerivedValue(() => affineToMatrix(visual.value.group));
  const placement = useDerivedValue(() => affineToMatrix(imagePlacement(visual.value, imageWidth)));
  const { frameRect, dim, gridPath, corners } = useCropPaths(visual);

  const enter = useDerivedValue(() => motion.enter.value);
  const gridOpacity = useDerivedValue(
    () => motion.grid.value * Opacity.cropLine * motion.enter.value,
  );
  const dimOpacity = useDerivedValue(() => Opacity.cropDim * motion.enter.value);
  const lineOpacity = useDerivedValue(() => Opacity.cropLine * motion.enter.value);

  // За краем фото — пусто, а не растянутые крайние пиксели: вытащенный за
  // край кусок должен выглядеть пустым, пока фото пружинит обратно.
  const photo = (
    <Group matrix={placement}>
      <Rect x={0} y={0} width={imageWidth} height={imageHeight}>
        <ImageShader image={image} tx="decal" ty="decal" fit="none" sampling={PHOTO_SAMPLING} />
        <ColorMatrix matrix={colors} />
      </Rect>
    </Group>
  );

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID="media-preview-crop"
        style={StyleSheet.absoluteFill}
        pointerEvents={active ? 'auto' : 'none'}
      >
        <Canvas style={StyleSheet.absoluteFill}>
          <Group matrix={group}>
            {/* За рамкой фото проявляется на входе и гаснет на выходе. */}
            <Group opacity={enter}>{photo}</Group>
            <Path path={dim} color={theme.viewerBackground} opacity={dimOpacity} />
            <Group clip={frameRect}>{photo}</Group>
            <Path
              path={gridPath}
              style="stroke"
              strokeWidth={Sizes.cropBorder}
              color={theme.textOnMedia}
              opacity={gridOpacity}
            />
            <Rect
              rect={frameRect}
              style="stroke"
              strokeWidth={Sizes.cropBorder}
              color={theme.textOnMedia}
              opacity={lineOpacity}
            />
            <Path path={corners} color={theme.textOnMedia} opacity={enter} />
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}
