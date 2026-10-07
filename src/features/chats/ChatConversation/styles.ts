import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  banner: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
  },
});
