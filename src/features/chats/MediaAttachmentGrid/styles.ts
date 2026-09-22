import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    position: 'relative',
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  tile: {
    position: 'absolute',
  },
  image: {
    flex: 1,
  },
  videoBadge: {
    position: 'absolute',
    right: Spacing.one,
    bottom: Spacing.one,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
    borderRadius: Radii.sm,
  },
});
