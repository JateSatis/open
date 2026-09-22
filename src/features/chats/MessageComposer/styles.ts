import { StyleSheet } from 'react-native';

import { Radii, Spacing, Typography } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  field: {
    flex: 1,
    maxHeight: Spacing.six + Spacing.five,
    borderWidth: 1,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    ...Typography.body,
  },
  notice: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
