import { StyleSheet } from 'react-native';

import { Radii, Shadows, Sizes } from '@/theme';

export const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: Sizes.floatingButtonMargin,
    width: Sizes.floatingButton,
    height: Sizes.floatingButton,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.floating,
  },
});
