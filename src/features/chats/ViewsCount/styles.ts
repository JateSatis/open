import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  views: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  /** На медиа без подписи — плашкой, как время. */
  overlay: {
    paddingHorizontal: Spacing.one + Spacing.half,
    paddingVertical: Spacing.half,
    borderRadius: Radii.md,
  },
});
