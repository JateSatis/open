import { StyleSheet } from 'react-native';

import { Radii, Sizes, Typography } from '@/theme';

export const styles = StyleSheet.create({
  circle: {
    width: Sizes.commentsCircle,
    height: Sizes.commentsCircle,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Число вплотную под значком: строка шрифта по его размеру, без воздуха. */
  count: {
    lineHeight: Typography.smallBold.fontSize,
  },
});
