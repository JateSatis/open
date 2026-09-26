import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  group: {
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  title: {
    textAlign: 'center',
    paddingVertical: Spacing.two,
  },
  option: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
