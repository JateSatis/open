import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  notice: {
    position: 'absolute',
    right: 0,
    bottom: '100%',
    marginBottom: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.md,
  },
});
