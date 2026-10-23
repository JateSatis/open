import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    marginHorizontal: Spacing.two,
    borderRadius: Radii.lg,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  findings: {
    gap: Spacing.two,
  },
  finding: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  findingText: {
    flex: 1,
  },
  actions: {
    gap: Spacing.two,
  },
});
