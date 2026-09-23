import { StyleSheet } from 'react-native';

import { GRID_GAP } from '@/features/media/MediaGrid/gridLayout';

export const styles = StyleSheet.create({
  /**
   * Начинается там, где первая строка сетки, и тянется до конца содержимого.
   * `overflow: hidden` обрезает лишние куски: их рисуется столько, сколько
   * нужно на самую длинную галерею, а содержимое обычно короче.
   */
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  canvas: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: GRID_GAP,
    right: GRID_GAP,
  },
  columnRule: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: GRID_GAP,
  },
});
