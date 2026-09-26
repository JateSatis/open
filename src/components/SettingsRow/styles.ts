import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - Spacing.one,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  accessory: {
    alignItems: 'flex-end',
  },
});
