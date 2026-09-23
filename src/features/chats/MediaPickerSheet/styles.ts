import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

const HANDLE_BAR_WIDTH = Spacing.five + Spacing.one;
const HANDLE_BAR_HEIGHT = Spacing.one;

/**
 * Высота полоски-ручки вместе с отступами. Списку она нужна числом: на эту
 * высоту поднимается его шапка, чтобы первая строка грида не легла поверх
 * ручки.
 */
export const HANDLE_BLOCK_HEIGHT = Spacing.two * 2 + HANDLE_BAR_HEIGHT;

export const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  /** Фон шита с ручкой. Лежит под списком и следует за его скроллом. */
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
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
  handle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
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
