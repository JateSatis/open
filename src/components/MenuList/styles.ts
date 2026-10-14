import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  /** Без ширины: меню по самому длинному пункту, пункты тянутся до него. */
  menu: {
    flexShrink: 0,
    minWidth: Sizes.menuMinWidth,
    paddingVertical: Spacing.one,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  item: {
    height: Sizes.menuRowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
});
