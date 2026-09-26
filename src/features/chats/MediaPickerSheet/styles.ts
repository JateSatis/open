import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

const HANDLE_BAR_WIDTH = Spacing.five + Spacing.one;
const HANDLE_BAR_HEIGHT = Spacing.one;

/**
 * Высота верхнего края шита вместе с ручкой и отступами. Списку она нужна
 * числом: шапка сдвигает начало содержимого, а `getItemLayout` считает
 * положение строк формулой от этого начала.
 */
export const SHEET_TOP_HEIGHT = Spacing.two * 2 + HANDLE_BAR_HEIGHT + Spacing.half;

export const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  /**
   * Окно списка. Начинается там же, где верхний предел шита, и обрезает
   * содержимое: доскроллив грид, клетки не должны выходить за верхний край
   * шита и лезть под статус-бар.
   */
  listWindow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  /**
   * Подложка шита. Абсолютный слой внутри содержимого списка: `top` ей
   * задаёт шит (высота прозрачной шапки), а `bottom: 0` дотягивает её до
   * конца содержимого. Скругление верхних углов здесь же — фон и скругление
   * обязаны быть одним и тем же вью, иначе между ними появится шов.
   */
  surface: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
  },
  /** Оболочка первого кадра: та же подложка, что в списке, только неподвижная. */
  shell: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    overflow: 'hidden',
  },
  /** Верхний край шита с ручкой. Фон под ним рисует подложка. */
  sheetTop: {
    alignItems: 'center',
    paddingTop: Spacing.two,
  },
  handleBar: {
    width: HANDLE_BAR_WIDTH,
    height: HANDLE_BAR_HEIGHT,
    borderRadius: Radii.full,
  },
  // Строка ввода прижата к низу экрана и уходит вниз только вместе с
  // закрытием шита — с положением самого шита она не связана.
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
