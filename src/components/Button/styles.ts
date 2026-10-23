import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sm: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  md: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  lg: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
  },
  disabled: {
    opacity: 0.5,
  },
  /** Длинная подпись при крупном шрифте переносится — по центру, как и в строку. */
  label: {
    flexShrink: 1,
    textAlign: 'center',
  },
});
