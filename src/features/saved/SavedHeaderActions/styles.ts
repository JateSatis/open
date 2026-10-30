import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
  },
  dot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: Sizes.savedFilterDot,
    height: Sizes.savedFilterDot,
    borderRadius: Radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
