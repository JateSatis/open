import { StyleSheet } from 'react-native';

import { Radii, Sizes } from '@/theme';

export const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: Sizes.floatingButtonMargin,
    bottom: Sizes.floatingButtonMargin,
    width: Sizes.floatingButton,
    height: Sizes.floatingButton,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
