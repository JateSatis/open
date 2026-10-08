import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  strip: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  thumbnail: {
    width: Sizes.editThumbnail,
    height: Sizes.editThumbnail,
    borderRadius: Radii.sm,
    overflow: 'hidden',
  },
  image: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  videoMark: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
  voiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    paddingVertical: Spacing.one,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.one,
    borderRadius: Radii.lg,
  },
  voicePlayer: {
    flex: 1,
  },
  voiceRemove: {
    padding: Spacing.one,
  },
});
