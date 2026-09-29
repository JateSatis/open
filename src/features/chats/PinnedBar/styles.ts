import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  accent: {
    width: Sizes.pinAccent,
    alignSelf: 'stretch',
    borderRadius: Radii.full,
  },
  thumbnail: {
    width: Sizes.pinThumbnail,
    height: Sizes.pinThumbnail,
    borderRadius: Radii.sm,
  },
  body: {
    flex: 1,
  },
});
