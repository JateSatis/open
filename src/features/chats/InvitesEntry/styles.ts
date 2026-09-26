import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
