import { StyleSheet } from 'react-native';

import { ComposerSizes, Radii, Spacing, Typography } from '@/theme';

/** Поле подписи — те же размеры, что у поля ввода в переписке. */
export const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fieldBox: {
    flex: 1,
    minHeight: ComposerSizes.fieldMinHeight,
    justifyContent: 'center',
    borderWidth: ComposerSizes.fieldBorder,
    borderRadius: Radii.lg,
  },
  field: {
    maxHeight: Spacing.six + Spacing.five,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    ...Typography.body,
  },
});
