import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  loader: {
    paddingVertical: Spacing.three,
  },
  footer: {
    gap: Spacing.two,
    padding: Spacing.three,
    paddingTop: Spacing.one,
  },
  linkButton: {
    alignSelf: 'stretch',
  },
});
