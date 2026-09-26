import { PixelRatio, useWindowDimensions } from 'react-native';

import { gridGeometry, type GridGeometry } from './gridLayout';

/** Геометрия сетки для текущего экрана — одна и та же у грида и у скелета. */
export function useGridGeometry(): GridGeometry {
  const { width } = useWindowDimensions();

  return gridGeometry(width, PixelRatio.get());
}
