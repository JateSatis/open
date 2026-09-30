import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  pill: {
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    maxWidth: '90%',
  },
  text: {
    textAlign: 'center',
  },
});
