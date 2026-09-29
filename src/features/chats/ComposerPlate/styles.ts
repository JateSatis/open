import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  plate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  accent: {
    alignSelf: 'stretch',
    width: Sizes.quoteAccent,
    borderRadius: Radii.full,
  },
  thumbnail: {
    width: Sizes.quoteThumbnail,
    height: Sizes.quoteThumbnail,
    borderRadius: Radii.sm,
  },
  body: {
    flex: 1,
  },
  close: {
    padding: Spacing.one,
  },
});
