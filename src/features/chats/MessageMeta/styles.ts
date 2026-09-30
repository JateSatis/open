import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.one,
  },
  /** Контур — доставлено, заливка того же цвета — прочитано. */
  receipt: {
    width: Sizes.receiptDot,
    height: Sizes.receiptDot,
    borderRadius: Radii.full,
    borderWidth: Sizes.receiptDotBorder,
  },
  overlay: {
    position: 'absolute',
    right: Spacing.one + Spacing.half,
    bottom: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.one + Spacing.half,
    paddingVertical: Spacing.half,
    borderRadius: Radii.md,
  },
});
