import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  /** Слишком длинное облачко обрезается снизу — видно его начало. */
  preview: {
    position: 'absolute',
    overflow: 'hidden',
  },
  menu: {
    position: 'absolute',
    width: Sizes.menuWidth,
    paddingVertical: Spacing.one,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  originStart: {
    transformOrigin: 'top left',
  },
  originEnd: {
    transformOrigin: 'top right',
  },
  item: {
    height: Sizes.menuRowHeight,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
});
