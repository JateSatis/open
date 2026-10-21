import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
  },
  group: {
    gap: Spacing.three,
  },
  groupTitle: {
    marginHorizontal: Spacing.three,
  },
  message: {
    marginHorizontal: Spacing.three,
  },
});
