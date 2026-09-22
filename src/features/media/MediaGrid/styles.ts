import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  content: {
    padding: Spacing.half,
  },
  row: {
    gap: Spacing.half,
    marginBottom: Spacing.half,
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
  footerSpace: {
    height: Spacing.four,
  },
});
