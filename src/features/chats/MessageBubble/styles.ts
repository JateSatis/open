import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  own: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '78%',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.lg,
    gap: Spacing.one,
  },
  /** Ширину задаёт мозаика; скругление облачка обрезает её углы. */
  mediaBubble: {
    borderRadius: Radii.lg,
    overflow: 'hidden',
  },
  mediaAuthor: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  caption: {
    paddingTop: Spacing.one + Spacing.half,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: Spacing.one,
  },
  attachmentSlot: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.md,
  },
});
