import { StyleSheet } from 'react-native';

import { Radii, Shadows, Spacing } from '@/theme';

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
  /** Без подложки, как в TikTok: тень держит число и на светлой обложке. */
  views: {
    position: 'absolute',
    left: Spacing.one,
    bottom: Spacing.one,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    ...Shadows.onMedia,
  },
  viewsText: {
    ...Shadows.textOnMedia,
  },
});
