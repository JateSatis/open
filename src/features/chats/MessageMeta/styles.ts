import { StyleSheet } from 'react-native';

import { Colors, Radii, Sizes, Spacing } from '@/theme';

/** Как обвести синее время на синем облачке: контуром букв или белой пилюлей. */
export const READ_OUTLINE = 'pill' as 'stroke' | 'pill';

export const styles = StyleSheet.create({
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  hidden: {
    opacity: 0,
  },
  /** Лоадер — в начале места времени, по высоте строки. */
  spinnerBox: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: Sizes.metaSpinner,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    transform: [{ scale: Sizes.metaSpinner / Sizes.activityIndicatorSmall }],
  },
  /** Копия времени для контура — под ним, той же строкой. */
  strokeCopy: {
    position: 'absolute',
  },
  // Левый отступ пилюли съеден отрицательным полем: время не сдвигается от
  // края облачка, когда синеет. Правый остаётся зазором до «изменено».
  // Белый в обеих темах: облачко под ним всегда синее.
  readPill: {
    backgroundColor: Colors.light.metaReadOutline,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.one,
    marginLeft: -Spacing.one,
  },
  overlay: {
    paddingHorizontal: Spacing.one + Spacing.half,
    paddingVertical: Spacing.half,
    borderRadius: Radii.md,
  },
  floating: {
    position: 'absolute',
    left: Spacing.one + Spacing.half,
    bottom: Spacing.one + Spacing.half,
  },
});
