import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  notice: {
    paddingTop: Spacing.two,
  },
  empty: {
    paddingTop: Spacing.four,
    textAlign: 'center',
  },
  footer: {
    paddingVertical: Spacing.three,
  },
});
