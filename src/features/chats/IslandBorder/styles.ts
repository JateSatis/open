import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

/**
 * Насколько рамка средней строки выходит за её край. Больше радиуса: иначе в
 * окно строки попало бы скругление угла, а не прямой пунктир.
 */
const OVERHANG = Radii.lg * 2;

export const styles = StyleSheet.create({
  /**
   * Окно строки: пунктир рисуется в полях списка, в стороне от облачков, — они
   * не сжимаются и стоят там же, где стояли бы без островка.
   */
  clip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -Spacing.two,
    right: -Spacing.two,
    overflow: 'hidden',
  },
  border: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderWidth: Sizes.islandBorder,
    borderStyle: 'dashed',
    borderRadius: Radii.lg,
  },
  top: {
    top: 0,
  },
  openTop: {
    top: -OVERHANG,
  },
  /** Низ рамки — с зазором до следующего сообщения, как у облачка. */
  bottom: {
    bottom: Spacing.two,
  },
  openBottom: {
    bottom: -OVERHANG,
  },
});
