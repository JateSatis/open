import {
  Canvas,
  ColorMatrix,
  FillType,
  Group,
  ImageShader,
  Path,
  Rect,
  Skia,
} from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { cropVisual, imagePlacement, type CropMotion } from './cropMotion';
import { PHOTO_SAMPLING } from './EditedPhoto';
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

/** Затемнение за рамкой тянется далеко за экран: при развороте его края не видны. */
const DIM_REACH = 4000;

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
  const frameRect = useDerivedValue(() => {
    const { frame } = visual.value;

    return Skia.XYWHRect(frame.x, frame.y, frame.width, frame.height);
  });

  const dim = useDerivedValue(() => {
    const { frame } = visual.value;
    const path = Skia.Path.Make();

    path.addRect(
      Skia.XYWHRect(
        frame.x - DIM_REACH,
        frame.y - DIM_REACH,
        frame.width + DIM_REACH * 2,
        frame.height + DIM_REACH * 2,
      ),
    );
    path.addRect(Skia.XYWHRect(frame.x, frame.y, frame.width, frame.height));
    path.setFillType(FillType.EvenOdd);

    return path;
  });

  const gridPath = useDerivedValue(() => {
    const { frame } = visual.value;
    const path = Skia.Path.Make();

    for (let line = 1; line < 3; line += 1) {
      const x = frame.x + (frame.width * line) / 3;
      const y = frame.y + (frame.height * line) / 3;

      path.moveTo(x, frame.y);
      path.lineTo(x, frame.y + frame.height);
      path.moveTo(frame.x, y);
      path.lineTo(frame.x + frame.width, y);
    }

    return path;
  });

  const corners = useDerivedValue(() => {
    const { frame } = visual.value;
    const path = Skia.Path.Make();
    const arm = Math.min(Sizes.cropCorner, frame.width / 2, frame.height / 2);
    const w = Sizes.cropCornerWidth;
    const left = frame.x - w;
    const top = frame.y - w;
    const right = frame.x + frame.width + w;
    const bottom = frame.y + frame.height + w;

    // Уголки — снаружи рамки, вплотную к окантовке.
    path.addRect(Skia.XYWHRect(left, top, arm + w, w));
    path.addRect(Skia.XYWHRect(left, top, w, arm + w));
    path.addRect(Skia.XYWHRect(right - arm - w, top, arm + w, w));
    path.addRect(Skia.XYWHRect(right - w, top, w, arm + w));
    path.addRect(Skia.XYWHRect(left, bottom - w, arm + w, w));
    path.addRect(Skia.XYWHRect(left, bottom - arm - w, w, arm + w));
    path.addRect(Skia.XYWHRect(right - arm - w, bottom - w, arm + w, w));
    path.addRect(Skia.XYWHRect(right - w, bottom - arm - w, w, arm + w));

    return path;
  });

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
