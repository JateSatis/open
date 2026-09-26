import { StyleSheet } from 'react-native';

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
});
