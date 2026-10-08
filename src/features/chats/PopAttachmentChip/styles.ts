import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  thumbnail: {
    width: Sizes.editThumbnail,
    height: Sizes.editThumbnail,
    borderRadius: Radii.sm,
    overflow: 'hidden',
  },
  label: {
    position: 'absolute',
    left: Spacing.half,
    bottom: Spacing.half,
    paddingHorizontal: Spacing.one,
    borderRadius: Radii.sm,
  },
  remove: {
    position: 'absolute',
    top: Spacing.half,
    right: Spacing.half,
    width: Sizes.editRemoveButton,
    height: Sizes.editRemoveButton,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
