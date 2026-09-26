import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  notice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  noticeText: {
    textAlign: 'center',
  },
});
