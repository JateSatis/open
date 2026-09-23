import { StyleSheet } from 'react-native';

import { Radii, Spacing, Typography } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  field: {
    flex: 1,
    maxHeight: Spacing.six + Spacing.five,
    borderWidth: 1,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    ...Typography.body,
  },
  notice: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sendWrapper: {
    position: 'relative',
  },
  mediaBadge: {
    position: 'absolute',
    top: -Spacing.one,
    right: -Spacing.one,
    minWidth: Spacing.four,
    height: Spacing.four,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
    borderWidth: 2,
  },
});
