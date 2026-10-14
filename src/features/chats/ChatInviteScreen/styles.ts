import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  search: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  list: {
    paddingHorizontal: Spacing.three,
  },
  centered: {
    padding: Spacing.four,
    alignItems: 'center',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
});
