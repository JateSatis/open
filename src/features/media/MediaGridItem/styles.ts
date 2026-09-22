import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

const CIRCLE_SIZE = 24;

export const styles = StyleSheet.create({
  thumbnail: {
    ...StyleSheet.absoluteFill,
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
    top: Spacing.one,
    left: Spacing.one,
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
