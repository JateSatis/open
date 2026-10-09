import { Canvas, ColorMatrix, Image, type SkImage } from '@shopify/react-native-skia';
import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { adjustColorMatrix } from '@/features/media/photoEdits/colorMatrix';

/** Ползунки цвета на UI-потоке — их двигает инструмент, читает живой показ. */
export type LiveAdjust = {
  exposure: SharedValue<number>;
  contrast: SharedValue<number>;
  saturation: SharedValue<number>;
  /** 1 — палец держит фото: показать оригинал. */
  original: SharedValue<number>;
};

export type EditedPhotoProps = {
  image: SkImage;
  width: number;
  height: number;
  adjust: LiveAdjust;
};

const IDENTITY = adjustColorMatrix({ exposure: 0, contrast: 0, saturation: 0 });

/**
 * Рабочая копия фото с правкой цвета. Матрица считается в ворклете из
 * ползунков: React на каждом кадре перетаскивания не перерисовывается, и
 * фото меняется вслед за пальцем.
 */
export function EditedPhoto({ image, width, height, adjust }: EditedPhotoProps) {
  const matrix = useDerivedValue(() =>
    adjust.original.value > 0
      ? IDENTITY
      : adjustColorMatrix({
          exposure: adjust.exposure.value,
          contrast: adjust.contrast.value,
          saturation: adjust.saturation.value,
        }),
  );

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image image={image} x={0} y={0} width={width} height={height} fit="fill">
        <ColorMatrix matrix={matrix} />
      </Image>
    </Canvas>
  );
}
