import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  /** Окно списка: копия облачка не рисуется поверх заголовка и поля ввода. */
  clip: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  preview: {
    position: 'absolute',
  },
  menuRow: {
    position: 'absolute',
    left: Spacing.two,
    right: Spacing.two,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  spacer: {
    flexShrink: 1,
  },
  /** Без ширины: меню по самому длинному пункту, пункты тянутся до него. */
  menu: {
    flexShrink: 0,
    minWidth: Sizes.menuMinWidth,
    paddingVertical: Spacing.one,
    borderRadius: Radii.md,
    overflow: 'hidden',
    transformOrigin: 'top left',
  },
  pickerOrigin: {
    transformOrigin: 'top left',
  },
  item: {
    height: Sizes.menuRowHeight,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
});
