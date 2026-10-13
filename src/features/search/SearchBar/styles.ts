import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing, Typography } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: Sizes.searchField,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.md,
  },
  input: {
    ...Typography.body,
    flex: 1,
    paddingVertical: 0,
  },
});
