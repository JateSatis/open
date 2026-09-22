import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

const THUMBNAIL_SIZE = Spacing.six;
const REMOVE_BADGE_SIZE = Spacing.three;

export const styles = StyleSheet.create({
  content: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  thumbnailWrapper: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: Radii.sm,
    overflow: 'hidden',
  },
  thumbnail: {
    flex: 1,
  },
  videoBadge: {
    position: 'absolute',
    left: Spacing.half,
    bottom: Spacing.half,
    paddingHorizontal: Spacing.half,
    borderRadius: Radii.sm,
  },
  removeBadge: {
    position: 'absolute',
    top: Spacing.half,
    right: Spacing.half,
    width: REMOVE_BADGE_SIZE,
    height: REMOVE_BADGE_SIZE,
    borderRadius: REMOVE_BADGE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
