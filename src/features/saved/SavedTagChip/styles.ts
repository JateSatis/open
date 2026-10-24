import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  chip: {
    minHeight: Spacing.five,
    maxWidth: '100%',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.full,
  },
});
