import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
    borderRadius: Radii.sm,
  },
  label: {
    left: Spacing.one,
    top: Spacing.one,
  },
  duration: {
    right: Spacing.one,
    bottom: Spacing.one,
  },
});
