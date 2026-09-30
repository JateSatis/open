import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    maxWidth: '90%',
  },
  text: {
    flexShrink: 1,
  },
});
