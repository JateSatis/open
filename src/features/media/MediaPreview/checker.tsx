import {
  FilterMode,
  ImageShader,
  MipmapMode,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';

import { DrawColors, Sizes } from '@/theme';

let checker: SkImage | null = null;

/**
 * Шахматная клетка 2×2 пикселя — её растягивают шейдером с ближайшим
 * пикселем до клетки нужного размера: края чёткие, картинка одна на всех.
 */
export function checkerImage(): SkImage | null {
  if (checker) return checker;

  const surface = Skia.Surface.Make(2, 2);

  if (!surface) return null;

  const canvas = surface.getCanvas();
  const paint = Skia.Paint();

  canvas.clear(Skia.Color(DrawColors.checkerLight));
  paint.setColor(Skia.Color(DrawColors.checkerDark));
  canvas.drawRect(Skia.XYWHRect(1, 0, 1, 1), paint);
  canvas.drawRect(Skia.XYWHRect(0, 1, 1, 1), paint);
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  const raster = snapshot.makeNonTextureImage();

  surface.dispose();
  if (raster && raster !== snapshot) snapshot.dispose();
  checker = raster ?? snapshot;

  return checker;
}

export type CheckerShaderProps = {
  /** Сторона клетки, точки. */
  cell?: number;
};

/** Шахматная клетка заливкой фигуры — фон под полупрозрачным цветом. */
export function CheckerShader({ cell = Sizes.drawCheckerCell }: CheckerShaderProps) {
  return (
    <ImageShader
      image={checkerImage()}
      tx="repeat"
      ty="repeat"
      fit="none"
      sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }}
      transform={[{ scale: cell }]}
    />
  );
}
