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
    textAlign: 'center',
  },
  content: {
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  identity: {
    alignItems: 'center',
    gap: Spacing.half,
  },
});
