import { StyleSheet } from 'react-native';

import { InfoPageSizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  bar: {
    height: InfoPageSizes.barHeight,
    paddingHorizontal: Spacing.one,
    flexDirection: 'row',
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
