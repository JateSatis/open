import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  star: {
    width: Sizes.chatListAvatar,
    height: Sizes.chatListAvatar,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
  },
  badge: {
    minWidth: Spacing.four,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.full,
    alignItems: 'center',
  },
});
