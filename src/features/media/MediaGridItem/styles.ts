import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

const CIRCLE_SIZE = 24;
const CIRCLE_INSET = Spacing.one;
/** Запас касания кружка — как у `hitSlop` его кнопки. */
export const CIRCLE_HIT_SLOP = Spacing.two;
/** Угол клетки, касание в котором — кружок выбора, а не открытие файла. */
export const CIRCLE_TOUCH_ZONE = CIRCLE_INSET + CIRCLE_SIZE + CIRCLE_HIT_SLOP;

export const styles = StyleSheet.create({
  thumbnail: {
    ...StyleSheet.absoluteFill,
  },
  broken: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    right: Spacing.one,
    bottom: Spacing.one,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
    borderRadius: Radii.sm,
  },
  circle: {
    position: 'absolute',
    top: CIRCLE_INSET,
    left: CIRCLE_INSET,
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
