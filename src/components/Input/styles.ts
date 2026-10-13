import { StyleSheet } from 'react-native';

import { Radii, Spacing, Typography } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  field: {
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    ...Typography.body,
  },
  withSuffix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  // Отступы и рамку держит обёртка; у самого поля на Android свои отступы,
  // которые иначе раздули бы высоту относительно поля без приставки.
  bare: {
    flex: 1,
    padding: 0,
    ...Typography.body,
  },
});
