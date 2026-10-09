import { Canvas, ColorMatrix, ImageShader, Rect, type SkImage } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { adjustColorMatrix } from '@/features/media/photoEdits/colorMatrix';
import { affineToMatrix, cropTransform, type PhotoCrop } from '@/features/media/photoEdits/crop';

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
  /** Обрезка — фото рисуется уже обрезанным во весь `width × height`. */
  crop: PhotoCrop;
};

/**
 * Фильтр Митчелла. Без явного `sampling` Skia берёт у шейдера кубический
 * фильтр с B = 1 — он заметно мылит фото.
 */
export const PHOTO_SAMPLING = { B: 1 / 3, C: 1 / 3 };

const IDENTITY = adjustColorMatrix({ exposure: 0, contrast: 0, saturation: 0 });

/**
 * Рабочая копия фото с правкой: обрезка тем же преобразованием, что и при
 * запекании, и цвет. Матрица цвета считается в ворклете из ползунков: React
 * на каждом кадре перетаскивания не перерисовывается, и фото меняется вслед
 * за пальцем. Удержание показывает фото без цвета, но с обрезкой.
 */
export function EditedPhoto({ image, width, height, adjust, crop }: EditedPhotoProps) {
  const matrix = useDerivedValue(() =>
    adjust.original.value > 0
      ? IDENTITY
      : adjustColorMatrix({
          exposure: adjust.exposure.value,
          contrast: adjust.contrast.value,
          saturation: adjust.saturation.value,
        }),
  );

  const place = useMemo(
    () => affineToMatrix(cropTransform(crop, { x: 0, y: 0, width, height }, image.width())),
    [crop, height, image, width],
  );

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height}>
        {/* Края — своими пикселями: сглаживание на границе не тянет внутрь кайму. */}
        <ImageShader
          image={image}
          tx="clamp"
          ty="clamp"
          fit="none"
          matrix={place}
          sampling={PHOTO_SAMPLING}
        />
        <ColorMatrix matrix={matrix} />
      </Rect>
    </Canvas>
  );
}
