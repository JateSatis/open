import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: Spacing.three,
    padding: Spacing.four,
  },
  actions: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
});
