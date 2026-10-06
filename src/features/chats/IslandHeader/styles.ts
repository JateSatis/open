import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  /** Над облачками, внутри рамки: сверху — отступ от пунктира, снизу — от первого облачка. */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  plate: {
    flexShrink: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radii.full,
  },
  /** Лоадер отправки — того же размера, что на месте времени в облачке. */
  spinnerBox: {
    width: Sizes.metaSpinner,
    height: Sizes.metaSpinner,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    transform: [{ scale: Sizes.metaSpinner / Sizes.activityIndicatorSmall }],
  },
});
