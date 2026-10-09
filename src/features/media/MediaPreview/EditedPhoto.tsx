import {
  Canvas,
  ColorMatrix,
  Group,
  Image,
  ImageShader,
  Paint,
  Rect,
  type SkImage,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { DrawingLayers } from './drawingLayers';
import { LiveStroke } from './LiveStroke';
import type { LiveDraw } from './useDrawTool';

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
  /** Сведённый рисунок фото. */
  layers: DrawingLayers;
  /** Открыто рисование: слои, штрих под пальцем и увеличение — от него. */
  draw: LiveDraw | null;
};

/**
 * Фильтр Митчелла. Без явного `sampling` Skia берёт у шейдера кубический
 * фильтр с B = 1 — он заметно мылит фото.
 */
export const PHOTO_SAMPLING = { B: 1 / 3, C: 1 / 3 };

const IDENTITY = adjustColorMatrix({ exposure: 0, contrast: 0, saturation: 0 });
const NO_ZOOM = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Рабочая копия фото с правкой: обрезка тем же преобразованием, что и при
 * запекании, цвет и рисунок. Матрица цвета считается в ворклете из
 * ползунков: React на каждом кадре перетаскивания не перерисовывается, и
 * фото меняется вслед за пальцем. Удержание показывает фото без цвета, но с
 * обрезкой и рисунком.
 *
 * Рисунок — две готовые картинки размером с копию (`drawingLayers.ts`) под
 * той же матрицей, что фото: размытие — под цветом, линии — поверх, без
 * него. В рисовании поверх них — штрих под пальцем.
 */
export function EditedPhoto({
  image,
  width,
  height,
  adjust,
  crop,
  layers,
  draw,
}: EditedPhotoProps) {
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

  const zoom = useDerivedValue(() => {
    if (!draw) return NO_ZOOM;

    const scale = draw.zoom.scale.value;

    return [scale, 0, draw.zoom.x.value, 0, scale, draw.zoom.y.value, 0, 0, 1];
  });
  const blurLayer = useDerivedValue(() => (draw ? draw.layers.value.blur : layers.blur));
  const linesLayer = useDerivedValue(() => (draw ? draw.layers.value.lines : layers.lines));
  const drawn = draw !== null || layers.blur !== null || layers.lines !== null;
  const imageWidth = image.width();
  const imageHeight = image.height();

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Group matrix={zoom}>
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

        {drawn ? (
          <Group matrix={place}>
            {/* Размытие — часть снимка: цвет ложится и на него. */}
            <Group
              layer={
                <Paint>
                  <ColorMatrix matrix={matrix} />
                </Paint>
              }
            >
              <Image
                image={blurLayer}
                x={0}
                y={0}
                width={imageWidth}
                height={imageHeight}
                sampling={PHOTO_SAMPLING}
              />
              {draw ? <LiveStroke draw={draw} imageWidth={imageWidth} layer="blur" /> : null}
            </Group>
            {/* Свой слой — только ластику под пальцем: вычищать линии, а не фото. */}
            <Group layer={draw !== null}>
              <Image
                image={linesLayer}
                x={0}
                y={0}
                width={imageWidth}
                height={imageHeight}
                sampling={PHOTO_SAMPLING}
              />
              {draw ? <LiveStroke draw={draw} imageWidth={imageWidth} layer="lines" /> : null}
            </Group>
          </Group>
        ) : null}
      </Group>
    </Canvas>
  );
}
