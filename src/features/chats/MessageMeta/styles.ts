import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing, Typography } from '@/theme';

export const styles = StyleSheet.create({
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  /** Место иконки статуса — постоянной ширины, по высоте строки времени. */
  status: {
    width: Sizes.deliveryStatus,
    height: Sizes.deliveryStatusIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    transform: [{ scale: Sizes.metaSpinner / Sizes.activityIndicatorSmall }],
  },
  failed: {
    width: Sizes.deliveryStatusIcon,
    height: Sizes.deliveryStatusIcon,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failedMark: {
    fontWeight: Typography.smallBold.fontWeight,
    lineHeight: Sizes.deliveryStatusIcon,
  },
  doubleCheck: {
    width: Sizes.deliveryStatusIcon + Sizes.deliveryCheckShift,
    height: Sizes.deliveryStatusIcon,
  },
  secondCheck: {
    position: 'absolute',
    left: Sizes.deliveryCheckShift,
    top: 0,
  },
  overlay: {
    paddingHorizontal: Spacing.one + Spacing.half,
    paddingVertical: Spacing.half,
    borderRadius: Radii.md,
  },
});
