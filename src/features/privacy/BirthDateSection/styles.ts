import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  error: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
});
