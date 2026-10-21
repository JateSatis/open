import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  hint: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  center: {
    textAlign: 'center',
  },
  banner: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
  },
});
