import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  track: {
    height: Sizes.segmentedControl,
    flexDirection: 'row',
    borderRadius: Radii.md,
    padding: Spacing.half,
  },
  indicator: {
    position: 'absolute',
    top: Spacing.half,
    bottom: Spacing.half,
    left: Spacing.half,
    borderRadius: Radii.md - Spacing.half,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  badge: {
    minWidth: Sizes.segmentBadge,
    height: Sizes.segmentBadge,
    borderRadius: Sizes.segmentBadge / 2,
    paddingHorizontal: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
