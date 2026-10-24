import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  more: {
    minHeight: Spacing.five,
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
  },
});
