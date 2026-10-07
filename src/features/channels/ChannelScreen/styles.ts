import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  segments: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
});
