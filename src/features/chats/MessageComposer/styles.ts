import { StyleSheet } from 'react-native';

import { ComposerSizes, Opacity, Radii, Spacing, Typography } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  /** Поле занимает всё место между кнопками по краям; кнопка эмодзи — внутри, слева. */
  fieldBox: {
    flex: 1,
    minHeight: ComposerSizes.fieldMinHeight,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: ComposerSizes.fieldBorder,
    borderRadius: Radii.lg,
  },
  /** Квадрат в одну строку поля: кнопка эмодзи стоит у нижнего края, когда поле растёт. */
  fieldButton: {
    width: ComposerSizes.fieldMinHeight,
    height: ComposerSizes.fieldMinHeight - ComposerSizes.fieldBorder * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locked: {
    opacity: Opacity.disabled,
  },
  field: {
    flex: 1,
    maxHeight: Spacing.six + Spacing.five,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    paddingLeft: 0,
    paddingRight: Spacing.three,
    ...Typography.body,
  },
  notice: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
