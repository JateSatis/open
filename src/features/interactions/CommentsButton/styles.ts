import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  /** Против нижнего края облачка, как «поделиться» в Telegram. */
  button: {
    alignSelf: 'flex-end',
    minWidth: Sizes.commentsButton,
    height: Sizes.commentsButton,
    paddingHorizontal: Spacing.one + Spacing.half,
    borderRadius: Radii.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
  },
});
