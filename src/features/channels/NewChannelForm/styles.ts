import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  fields: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  description: {
    minHeight: Spacing.six,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
});
