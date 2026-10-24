import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  chip: {
    minHeight: Spacing.five,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.full,
  },
  input: {
    minWidth: Spacing.six + Spacing.five,
    minHeight: Spacing.five,
    paddingVertical: 0,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  more: {
    minHeight: Spacing.five,
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
  },
});
