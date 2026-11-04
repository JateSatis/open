import { StyleSheet } from 'react-native';

import { Radii, Shadows, Sizes, Typography } from '@/theme';

export const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    zIndex: 1,
    right: Sizes.floatingButtonMargin,
    width: Sizes.floatingButton,
    height: Sizes.floatingButton,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.floating,
  },
  badge: {
    position: 'absolute',
    top: -Sizes.jumpDownBadge / 4,
    right: -Sizes.jumpDownBadge / 4,
    minWidth: Sizes.jumpDownBadge,
    height: Sizes.jumpDownBadge,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    ...Typography.captionBold,
  },
});
