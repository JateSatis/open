import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radii.md,
    borderTopRightRadius: Radii.md,
    maxHeight: '90%',
  },
  content: {
    gap: Spacing.three,
    padding: Spacing.three,
  },
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
