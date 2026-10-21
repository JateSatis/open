import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingBottom: Spacing.five,
  },
  sectionTitle: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    textTransform: 'uppercase',
  },
  empty: {
    paddingHorizontal: Spacing.three,
  },
  problem: {
    padding: Spacing.three,
  },
});
