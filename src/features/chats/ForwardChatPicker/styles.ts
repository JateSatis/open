import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  search: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  list: {
    paddingHorizontal: Spacing.three,
  },
  message: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
});
