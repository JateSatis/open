import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  lead: {
    gap: Spacing.one,
  },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  labelText: {
    flexShrink: 1,
  },
  /** Автор комментария — сразу над его текстом, как имя в облачке. */
  author: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    paddingTop: Spacing.one,
  },
});
