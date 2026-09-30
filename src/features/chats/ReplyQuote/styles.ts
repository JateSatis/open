import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing, Typography } from '@/theme';

export const styles = StyleSheet.create({
  list: {
    gap: Spacing.one,
  },
  quote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radii.sm,
    overflow: 'hidden',
  },
  accent: {
    alignSelf: 'stretch',
    width: Sizes.quoteAccent,
    marginVertical: -Spacing.one,
  },
  thumbnail: {
    width: Sizes.quoteThumbnail,
    height: Sizes.quoteThumbnail,
    borderRadius: Radii.sm,
  },
  /** Две строки — автор и фрагмент — при любом оригинале: облачко не меняет высоту. */
  body: {
    flexShrink: 1,
    minHeight: Typography.smallBold.lineHeight + Typography.small.lineHeight,
    justifyContent: 'center',
  },
  deleted: {
    fontStyle: 'italic',
  },
});
