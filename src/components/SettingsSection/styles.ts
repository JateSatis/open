import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  title: {
    paddingHorizontal: Spacing.three,
    textTransform: 'uppercase',
  },
  card: {
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  footer: {
    paddingHorizontal: Spacing.three,
  },
});
