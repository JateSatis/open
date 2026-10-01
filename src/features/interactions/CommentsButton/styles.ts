import { StyleSheet } from 'react-native';

import { Opacity, Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  button: {
    minWidth: Sizes.commentsButton,
    height: Sizes.commentsButton,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  /** Без подложки и полупрозрачная: возможность видна, но не спорит с облачком. */
  quiet: {
    minWidth: 0,
    height: 'auto',
    paddingHorizontal: 0,
    opacity: Opacity.quiet,
  },
});
