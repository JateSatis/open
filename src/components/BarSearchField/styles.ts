import { StyleSheet } from 'react-native';

import { Spacing, Typography } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  button: {
    padding: Spacing.two,
  },
  input: {
    ...Typography.body,
    flex: 1,
    paddingVertical: 0,
  },
});
