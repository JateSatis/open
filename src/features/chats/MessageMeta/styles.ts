import { StyleSheet } from 'react-native';

import { Colors, Radii, Sizes, Spacing } from '@/theme';

/** Как обвести синее время на синем облачке: контуром букв или белой пилюлей. */
const READ_OUTLINE = 'stroke' as 'stroke' | 'pill';

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
  // Контур белый в обеих темах: облачко под ним всегда синее.
  readStroke:
    READ_OUTLINE === 'stroke'
      ? {
          textShadowColor: Colors.light.metaReadOutline,
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: Sizes.metaReadOutline * 2,
        }
      : {},
  // Отступ пилюли съеден отрицательным полем: время не сдвигается, когда синеет.
  readPill:
    READ_OUTLINE === 'pill'
      ? {
          backgroundColor: Colors.light.metaReadOutline,
          borderRadius: Radii.full,
          paddingHorizontal: Spacing.one,
          marginHorizontal: -Spacing.one,
        }
      : {},
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
