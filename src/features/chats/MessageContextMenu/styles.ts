import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

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
  menu: {
    transformOrigin: 'top left',
  },
  pickerOrigin: {
    transformOrigin: 'top left',
  },
});
