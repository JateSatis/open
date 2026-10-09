import { FillType, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { CropVisual } from './cropMotion';

import { Sizes } from '@/theme';

/** Затемнение за рамкой тянется далеко за экран: при развороте его края не видны. */
const DIM_REACH = 4000;

/**
 * Фигуры поверх фото в обрезке — рамка, затемнение снаружи, сетка 3×3 и
 * уголки-ручки — по рамке этого кадра, на UI-потоке.
 */
export function useCropPaths(visual: SharedValue<CropVisual>) {
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

  return { frameRect, dim, gridPath, corners };
}
